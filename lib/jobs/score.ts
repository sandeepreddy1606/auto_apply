/**
 * Explainable relevance score (0–100) for a job against your preferences.
 *
 *   score = 35·title + 30·skills + 15·experience + 10·location + 5·freshness + 5·company
 *
 * Hard filters force 0 and say why: an excluded keyword/company, seniority
 * outside your levels, a title that matches none of your target roles (when
 * you've set roles), or a job asking for far more experience than you have.
 * Pure: callers pass everything in.
 */
import type { JobPrefs, ScoreBreakdown, Seniority } from '@/lib/types'

import { analyzeJd, detectSeniority, parseExperience } from './analyze'

export interface ScoreInput {
  title: string
  location: string | null
  description_text: string | null
  posted_at: string | null
  first_seen_at: string | null
  company_id: number
  company_priority?: string | null
}

export interface ScoreContext {
  prefs: JobPrefs
  /** Canonical skills you have (resume skills ∪ profile skills ∪ inventory). */
  skills: Set<string>
  /** Your experience in years, or null if unknown. */
  years: number | null
  /** Fallback roles when no target roles are set (profile current role). */
  fallbackRoles: string[]
  now?: Date
}

const ROLE_SYNONYMS: string[][] = [
  ['software engineer', 'software developer', 'sde', 'swe', 'software development engineer', 'programmer', 'member of technical staff', 'mts'],
  ['backend engineer', 'backend developer', 'back end', 'back-end', 'server side', 'server-side', 'api engineer'],
  ['frontend engineer', 'frontend developer', 'front end', 'front-end', 'ui engineer', 'ui developer'],
  ['full stack', 'fullstack', 'full-stack'],
  ['machine learning engineer', 'ml engineer', 'ai engineer', 'applied scientist', 'ai/ml', 'ml/ai', 'deep learning engineer'],
  ['data scientist', 'data science'],
  ['data engineer', 'big data engineer', 'etl developer'],
  ['devops engineer', 'site reliability', 'sre', 'platform engineer', 'cloud engineer', 'infrastructure engineer'],
  ['qa engineer', 'sdet', 'test engineer', 'quality engineer', 'automation engineer'],
  ['mobile developer', 'android developer', 'ios developer', 'mobile engineer'],
]

const norm = (s: string): string =>
  ` ${(s || '').toLowerCase().replace(/[^a-z0-9+#/]+/g, ' ').replace(/\s+/g, ' ').trim()} `

/** Every phrase that should count as the same role as `role`. */
export function roleVariants(role: string): string[] {
  const r = norm(role).trim()
  const out = new Set([r])
  for (const group of ROLE_SYNONYMS) {
    if (group.some((g) => r.includes(g) || g.includes(r))) for (const g of group) out.add(g)
  }
  return [...out].filter(Boolean)
}

const GENERIC = new Set(['engineer', 'developer', 'intern', 'junior', 'senior', 'i', 'ii', 'iii', 'associate', 'level', 'and'])

/** Words that say what kind of job a title is (vs. what it's about). */
const JOB_NOUNS = new Set([
  'engineer', 'engineers', 'engineering', 'developer', 'developers', 'programmer', 'sde', 'swe', 'sdet',
  'scientist', 'architect', 'analyst', 'designer', 'mts', 'devops', 'sre', 'intern', 'internship',
])

/** Best similarity of the job title to any target role: [score 0–1, matched role]. */
export function titleScore(title: string, roles: string[]): [number, string | null] {
  const t = norm(title)
  let best = 0
  let bestRole: string | null = null
  for (const role of roles) {
    for (const v of roleVariants(role)) {
      if (!v) continue
      let s = 0
      if (t.includes(` ${v} `)) s = 1
      else {
        const vt = v.split(' ').filter((w) => !GENERIC.has(w))
        const tt = new Set(t.trim().split(' '))
        if (vt.length) {
          const hit = vt.filter((w) => tt.has(w)).length
          s = (hit / vt.length) * 0.8
          // A shared topic word isn't enough when the role names a kind of job:
          // "Software Engineer" must not match "Associate, Quality Services,
          // Auto Software". Require a job noun in the title too.
          const roleHasNoun = v.split(' ').some((w) => JOB_NOUNS.has(w))
          if (s > 0 && roleHasNoun && ![...tt].some((w) => JOB_NOUNS.has(w))) s *= 0.5
        }
        // "Software Engineer" vs "Engineer, Software" etc.
        if (s === 0 && v.split(' ').every((w) => tt.has(w))) s = 0.9
      }
      if (s > best) {
        best = s
        bestRole = role
      }
    }
  }
  return [best, bestRole]
}

const SENIORITY_ORDER: Seniority[] = ['intern', 'new_grad', 'junior', 'mid', 'senior']

function yearsToSeniority(years: number | null): Seniority | null {
  if (years === null) return null
  if (years < 1) return 'new_grad'
  if (years < 3) return 'junior'
  if (years < 6) return 'mid'
  return 'senior'
}

export function experienceScore(
  range: { min: number; max: number | null } | null,
  years: number | null,
  seniority: Seniority | null,
): number {
  if (years === null) return 0.6
  if (range) {
    if (years >= range.min && (range.max === null || years <= range.max + 0.5)) return 1
    if (years < range.min) return Math.max(0, 1 - (range.min - years) / 3)
    return Math.max(0.3, 1 - (years - (range.max ?? years)) / 6)
  }
  if (seniority) {
    const mine = yearsToSeniority(years)
    if (!mine) return 0.6
    const d = Math.abs(SENIORITY_ORDER.indexOf(seniority) - SENIORITY_ORDER.indexOf(mine))
    return d === 0 ? 1 : d === 1 ? 0.7 : 0.2
  }
  return 0.7
}

export function locationScore(location: string | null, prefs: JobPrefs): number {
  if (!prefs.locations.length) return 1
  const loc = (location || '').toLowerCase()
  if (!loc.trim()) return 0.6
  if (/\bremote\b|work from home|anywhere/.test(loc)) return prefs.remote_ok ? 1 : 0.3
  if (prefs.locations.some((p) => p && loc.includes(p.toLowerCase()))) return 1
  return prefs.open_to_relocation ? 0.5 : 0
}

export function freshnessScore(dateIso: string | null, windowDays: number, now = new Date()): number {
  if (!dateIso) return 0.5
  const t = Date.parse(dateIso)
  if (Number.isNaN(t)) return 0.5
  const days = (now.getTime() - t) / 86_400_000
  if (days <= 3) return 1
  if (days >= windowDays) return 0
  return 1 - (days - 3) / Math.max(1, windowDays - 3)
}

const wordRe = (kw: string): RegExp =>
  new RegExp(`(?<![a-z0-9])${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i')

export function scoreJob(job: ScoreInput, ctx: ScoreContext): { score: number; breakdown: ScoreBreakdown } {
  const { prefs } = ctx
  const roles = prefs.target_roles.length ? prefs.target_roles : ctx.fallbackRoles
  const text = job.description_text || ''
  const jd = analyzeJd(job.title, text)
  const seniority = detectSeniority(job.title)

  let excluded: string | null = null
  const kwHit = prefs.exclude_keywords.find((k) => k && wordRe(k).test(job.title))
  if (kwHit) excluded = `title contains "${kwHit}"`
  else if (prefs.excluded_companies.includes(job.company_id)) excluded = 'company excluded'
  else if (seniority && prefs.seniority.length && !prefs.seniority.includes(seniority)) {
    excluded = `seniority: ${seniority.replace('_', ' ')}`
  }

  const [tScore, tRole] = roles.length ? titleScore(job.title, roles) : [0.5, null]
  const range = jd.experience ?? parseExperience(job.title)

  // Your explicit target roles are a gate, not just a weight: a "Graphic
  // Designer" must not become relevant on skills + location alone.
  const explicitRoles = prefs.target_roles.length > 0
  if (!excluded && explicitRoles && prefs.require_title_match !== false && tScore < TITLE_GATE) {
    excluded = `title doesn't match your roles (${prefs.target_roles.slice(0, 3).join(', ')})`
  }
  const gap = prefs.max_experience_gap ?? 2
  if (!excluded && range && ctx.years !== null && gap < 10 && range.min - ctx.years > gap) {
    excluded = `asks for ${range.min}+ years (you have about ${formatYears(ctx.years)})`
  }

  const wanted = [...jd.required, ...jd.preferred]
  const have = wanted.filter((s) => ctx.skills.has(s))
  const missing = wanted.filter((s) => !ctx.skills.has(s))
  let sScore: number
  if (!wanted.length) sScore = text ? 0.5 : 0.4
  else {
    const reqHave = jd.required.filter((s) => ctx.skills.has(s)).length
    const prefHave = jd.preferred.filter((s) => ctx.skills.has(s)).length
    const denom = jd.required.length + 0.5 * jd.preferred.length
    sScore = denom ? (reqHave + 0.5 * prefHave) / denom : 0.5
  }
  const include = prefs.include_keywords.filter((k) => k && (wordRe(k).test(job.title) || wordRe(k).test(text)))
  sScore = Math.min(1, sScore + include.length * 0.05)

  const eScore = experienceScore(range, ctx.years, seniority)
  // A description that says the role is remote counts when you're open to remote.
  const lScore = Math.max(locationScore(job.location, prefs), jd.details.work_mode === 'remote' && prefs.remote_ok ? 1 : 0)
  const fScore = freshnessScore(job.posted_at || job.first_seen_at, prefs.freshness_days, ctx.now)
  const cScore = job.company_priority === 'high' ? 1 : job.company_priority === 'low' ? 0 : 0.5

  const raw = 35 * tScore + 30 * sScore + 15 * eScore + 10 * lScore + 5 * fScore + 5 * cScore
  const score = excluded ? 0 : Math.round(Math.min(100, Math.max(0, raw)))

  return {
    score,
    breakdown: {
      title: round2(tScore),
      title_match: tRole,
      skills: round2(sScore),
      skills_have: have,
      skills_missing: missing,
      experience: round2(eScore),
      experience_range: range ? (range.max === null ? `${range.min}+ y` : `${range.min}–${range.max} y`) : null,
      location: round2(lScore),
      freshness: round2(fScore),
      company: cScore,
      excluded,
      seniority,
    },
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Minimum title similarity for a job to count when you've set target roles. */
export const TITLE_GATE = 0.5

const formatYears = (y: number): string => (y < 1 ? `${Math.round(y * 12)} months` : `${Math.round(y * 10) / 10} years`)

/** One-line explanation for cards: "78 · title ✓ · 9/12 skills · exp fits · Bengaluru ✓". */
export function explain(score: number, b: ScoreBreakdown, location: string | null): string {
  if (b.excluded) return `Filtered: ${b.excluded}`
  const parts = [String(score)]
  parts.push(b.title >= 0.9 ? 'title ✓' : b.title >= 0.5 ? 'title ~' : 'title ✗')
  const total = b.skills_have.length + b.skills_missing.length
  if (total) parts.push(`${b.skills_have.length}/${total} skills`)
  if (b.experience_range) parts.push(b.experience >= 0.9 ? `exp fits (${b.experience_range})` : `exp ${b.experience_range}`)
  if (location && b.location >= 1) parts.push(`${location.split(',')[0]} ✓`)
  return parts.join(' · ')
}
