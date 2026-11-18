/** Builds the scoring context (your skills, years, roles) from settings + your default resume. */
import { profileYears } from '@/lib/server/matching'
import type { Settings } from '@/lib/types'

import type { ScoreContext } from './score'
import { canonicalSkills, withImplied } from './skills'

export async function buildScoreContext(settings: Settings): Promise<ScoreContext> {
  const skillSources: string[] = [settings.profile.skills || '', ...settings.job_prefs.include_keywords]
  let factYears: number | null = null
  let resumeRoles: string[] = []
  try {
    const { getDefaultFacts } = await import('@/lib/resume/store')
    const facts = await getDefaultFacts()
    if (facts) {
      skillSources.push(...facts.skills.flatMap((g) => g.items), ...facts.inventory_extra, ...facts.all_skills)
      factYears = experienceYearsFromFacts(facts.experience.map((e) => e.dates))
      resumeRoles = rolesFromTitles(facts.experience.map((e) => e.title))
    }
  } catch {
    /* no resume yet */
  }
  const override = Number.parseFloat(settings.job_prefs.experience_years_override)
  const years = Number.isFinite(override) ? override : (profileYears(settings.profile) ?? factYears)
  // No target roles set: use your current role, else the job titles on your resume.
  const role = (settings.profile.current_role || '').trim()
  return {
    prefs: settings.job_prefs,
    skills: withImplied(canonicalSkills(skillSources)),
    years,
    fallbackRoles: role ? [role] : resumeRoles,
  }
}

/**
 * Search-friendly roles from resume job titles: "Software Engineer Intern" →
 * "Software Engineer"; duplicates dropped; at most 3.
 */
export function rolesFromTitles(titles: string[]): string[] {
  const out: string[] = []
  for (const t of titles) {
    const clean = (t || '')
      .replace(/\\[a-z]+\{([^}]*)\}/gi, '$1')
      .replace(/[{}\\]/g, '')
      .replace(/\b(intern(ship)?|trainee|apprentice|part[- ]time|full[- ]time|contract|summer|winter)\b/gi, '')
      .replace(/\s*[-–—|,(].*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (clean.length < 3 || clean.length > 60) continue
    if (!out.some((o) => o.toLowerCase() === clean.toLowerCase())) out.push(clean)
    if (out.length >= 3) break
  }
  return out
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
}

function parseMonthYear(s: string, fallbackYear?: number): Date | null {
  const t = s.trim().toLowerCase()
  if (/present|current|now/.test(t)) return new Date()
  const m = /([a-z]{3,9})\.?\s*(\d{4})?/.exec(t)
  const y = /(\d{4})/.exec(t)
  const year = y ? Number(y[1]) : fallbackYear
  if (!year) return null
  const month = m ? (MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)] ?? 0) : 0
  return new Date(year, month, 1)
}

/**
 * Total work experience in years from entry date strings such as
 * "Apr 2026 -- Present" or "May -- June 2025". Internships count, overlaps don't double count.
 */
export function experienceYearsFromFacts(dates: string[], now = new Date()): number | null {
  const ranges: [number, number][] = []
  for (const d of dates) {
    const parts = d.replace(/\\textendash|–|—/g, '--').split(/\s*-{1,3}\s*/)
    if (parts.length < 2) continue
    const endYear = /(\d{4})/.exec(parts[1])?.[1]
    const start = parseMonthYear(parts[0], endYear ? Number(endYear) : undefined)
    const end = /present|current|now/i.test(parts[1]) ? now : parseMonthYear(parts[1])
    if (!start || !end || end < start) continue
    // End month is inclusive.
    ranges.push([start.getTime(), new Date(end.getFullYear(), end.getMonth() + 1, 1).getTime()])
  }
  if (!ranges.length) return null
  ranges.sort((a, b) => a[0] - b[0])
  let total = 0
  let [cs, ce] = ranges[0]
  for (const [s, e] of ranges.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e)
    else {
      total += ce - cs
      ;[cs, ce] = [s, e]
    }
  }
  total += ce - cs
  return Math.round((total / (365.25 * 86_400_000)) * 10) / 10
}
