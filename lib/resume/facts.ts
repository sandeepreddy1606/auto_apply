/**
 * Fact bank: the structured, single source of truth the tailoring step may
 * draw from. It's derived deterministically from the base LaTeX, plus your
 * overlay from Settings → Resume (extra bullets, extra true skills).
 */
import { canonicalSkills, extractSkills } from '@/lib/jobs/skills'
import type { FactBank, FactBullet, FactEntry, FactOverlay } from '@/lib/types'

import type { Entry, ResumeDoc } from './latex/parse'
import { latexToPlain } from './latex/util'

export const EMPTY_OVERLAY: FactOverlay = { extra_bullets: {}, inventory_extra: [], locked: [] }

const DATE_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*(\d{4})?\b|\b(19|20)\d{2}\b|present|current/i

/** Numbers a claim makes: 50%, 0.92, 500+, 100,000+, 20 FPS, 3x. Normalised for comparison. */
export function extractMetrics(text: string): string[] {
  const out = new Set<string>()
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(%|\+|x\b|k\b|m\b|fps\b|ms\b|s\b|hours?\b|seconds?\b|days?\b)?/gi
  let m: RegExpExecArray | null
  const plain = text.replace(/\\%/g, '%')
  while ((m = re.exec(plain))) {
    const n = m[1].replace(/,/g, '').replace(/\.$/, '')
    if (!n) continue
    out.add(n)
  }
  return [...out]
}

export function slug(s: string): string {
  return (
    latexToPlain(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'entry'
  )
}

function entryFields(e: Entry): { title: string; org: string; location: string; dates: string; stack: string[] } {
  const plain = e.args.map((a) => latexToPlain(a))
  if (e.macro === 'resumeProject') {
    // {name | type | link}{stack}{year}{}
    const [name] = plain[0].split('|').map((s) => s.trim())
    return {
      title: name || plain[0],
      org: '',
      location: '',
      dates: plain[2] || '',
      stack: (plain[1] || '').split(/,\s*/).map((s) => s.trim()).filter(Boolean),
    }
  }
  const dateIdx = plain.findIndex((p, i) => i > 0 && DATE_RE.test(p))
  const rest = plain.map((p, i) => (i === dateIdx ? '' : p))
  // This template: {title}{location}{org}{dates}; Jake's: {org}{location}{title}{dates}.
  // Both put the location second; title/org are told apart only for display.
  return {
    title: rest[0] || '',
    org: rest[2] || '',
    location: rest[1] || '',
    dates: dateIdx >= 0 ? plain[dateIdx] : '',
    stack: [],
  }
}

/** Stable ids per section: exp_<org-or-title>, prj_<name>, de-duplicated with a counter. */
export function entryIds(doc: ResumeDoc): Map<Entry, string> {
  const ids = new Map<Entry, string>()
  const used = new Set<string>()
  for (const s of doc.sections) {
    if (!s.entries || (s.kind !== 'experience' && s.kind !== 'projects')) continue
    for (const e of s.entries) {
      const f = entryFields(e)
      const base = `${s.kind === 'experience' ? 'exp' : 'prj'}_${slug(s.kind === 'experience' ? `${f.org || f.title}_${f.title}` : f.title)}`
      let id = base
      let n = 2
      while (used.has(id)) id = `${base}_${n++}`
      used.add(id)
      ids.set(e, id)
    }
  }
  return ids
}

export function buildFacts(doc: ResumeDoc, overlay: FactOverlay = EMPTY_OVERLAY): FactBank {
  const ids = entryIds(doc)
  const experience: FactEntry[] = []
  const projects: FactEntry[] = []
  const allMetrics = new Set<string>()
  const allSkills = new Set<string>()
  for (const s of doc.sections) {
    if (!s.entries || (s.kind !== 'experience' && s.kind !== 'projects')) continue
    for (const e of s.entries) {
      const id = ids.get(e)!
      const f = entryFields(e)
      const bullets: FactBullet[] = e.bullets.map((b, i) => {
        const text = latexToPlain(b.body)
        const metrics = extractMetrics(text)
        const skills = extractSkills(`${text} ${f.stack.join(', ')}`)
        metrics.forEach((m) => allMetrics.add(m))
        skills.forEach((k) => allSkills.add(k))
        return { id: `b${i + 1}`, latex: b.body, text, metrics, skills }
      })
      for (const x of overlay.extra_bullets[id] ?? []) {
        const metrics = extractMetrics(x.text)
        const skills = extractSkills(x.text)
        metrics.forEach((m) => allMetrics.add(m))
        skills.forEach((k) => allSkills.add(k))
        bullets.push({ id: x.id, latex: '', text: x.text, metrics, skills, extra: true })
      }
      const entry: FactEntry = { id, kind: s.kind === 'experience' ? 'experience' : 'project', ...f, bullets }
      ;(s.kind === 'experience' ? experience : projects).push(entry)
    }
  }
  const skillsSec = doc.sections.find((s) => s.kind === 'skills' && s.skills)
  const skills = (skillsSec?.skills?.lines ?? []).map((l) => ({
    category: latexToPlain(l.category),
    items: latexToPlain(l.items)
      .split(/\s*[,;]\s*/)
      .map((x) => x.trim())
      .filter(Boolean),
  }))
  for (const g of skills) for (const k of canonicalSkills(g.items)) allSkills.add(k)
  for (const k of canonicalSkills(overlay.inventory_extra)) allSkills.add(k)

  const summarySec = doc.sections.find((s) => s.kind === 'summary' && s.summary)
  const header = latexToPlain(doc.preamble.slice(doc.preamble.indexOf('\\begin{document}')))
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(doc.preamble)?.[0] ?? ''
  const phone = /(?:\+?\d[\d\s-]{8,}\d)/.exec(doc.preamble.replace(/\\newcommand\{\\phone\}\{(\d+)\}/, ' $1 '))?.[0]?.trim() ?? ''
  const name = /\\newcommand\{\\name\}\{([^}]*)\}/.exec(doc.preamble)?.[1] ?? header.split('\n').find((l) => l.trim())?.split('|')[0].trim() ?? ''
  return {
    name,
    email,
    phone,
    summary: summarySec?.summary ? latexToPlain(summarySec.summary.text) : '',
    skills,
    experience,
    projects,
    inventory_extra: overlay.inventory_extra,
    all_metrics: [...allMetrics],
    all_skills: [...allSkills].sort(),
  }
}

/** Plain-text view of the facts that the tailoring prompt sees. */
export function factsForPrompt(f: FactBank): unknown {
  const entry = (e: FactEntry) => ({
    id: e.id,
    heading: [e.title, e.org, e.dates].filter(Boolean).join(' · '),
    stack: e.stack.length ? e.stack : undefined,
    bullets: e.bullets.map((b) => ({ ref: b.id, text: b.text, extra: b.extra || undefined })),
  })
  return {
    summary: f.summary,
    skills: f.skills,
    skills_inventory_extra: f.inventory_extra,
    experience: f.experience.map(entry),
    projects: f.projects.map(entry),
  }
}
