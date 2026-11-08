/**
 * Fill empty Settings → Profile fields from your base resume, so autofill has
 * your name, email, phone, links, education and current role without typing
 * them twice. Never overwrites a field you've filled in yourself.
 */
import { experienceYearsFromFacts } from '@/lib/jobs/context'
import * as settingsStore from '@/lib/server/settings'
import type { Profile } from '@/lib/types'

import { buildFacts } from './facts'
import { parseResume } from './latex/parse'
import { latexToPlain, readArgs } from './latex/util'

/** "SANDEEP REDDY" → "Sandeep Reddy"; mixed case is left alone. */
function nameCase(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t !== t.toUpperCase()) return t
  return t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

function firstUrl(latex: string, re: RegExp): string {
  const m = re.exec(latex)
  if (!m) return ''
  const u = m[0].replace(/[}\s].*$/, '')
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

/** Profile fields derivable from a LaTeX resume. Empty strings where unknown. */
export function profileFromResume(latex: string): Partial<Profile> {
  const doc = parseResume(latex)
  const facts = buildFacts(doc)
  const out: Partial<Profile> = {}
  if (facts.name) out.full_name = nameCase(latexToPlain(facts.name))
  if (facts.email) out.email = facts.email.toLowerCase()
  if (facts.phone) out.phone = facts.phone.replace(/\s+/g, ' ').trim()

  out.linkedin = firstUrl(latex, /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/i)
  out.github = firstUrl(latex, /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?(?=[}\s"]|$)/i)

  // Current job: an experience entry that runs to "Present".
  const current = facts.experience.find((e) => /present|current|now/i.test(e.dates)) ?? null
  if (current) {
    out.current_role = latexToPlain(current.title).trim()
    out.current_company = latexToPlain(current.org).trim()
  }
  const loc = (current ?? facts.experience[0])?.location
  if (loc) out.current_location = latexToPlain(loc).trim()

  const years = experienceYearsFromFacts(facts.experience.map((e) => e.dates))
  if (years !== null) out.experience_years = String(Math.round(years * 10) / 10)

  const skills = facts.skills.flatMap((g) => g.items)
  if (skills.length) out.skills = [...new Set(skills)].slice(0, 40).join(', ')

  // Education: first entry, \resumeSubheading{College}{Location}{Degree}{Dates}.
  const edu = doc.sections.find((s) => s.kind === 'education' && s.entries?.length)?.entries?.[0]
  if (edu) {
    const args = edu.args.length ? edu.args : (readArgs(edu.head, 0, 4)?.args ?? [])
    const plain = args.map((a) => latexToPlain(a).trim())
    if (plain[0]) out.college = plain[0]
    if (plain[2]) out.degree = plain[2].replace(/\s*[;|]\s*(CGPA|GPA|CPI).*$/i, '').trim()
    // Graduation = the END of the date range ("Aug 2022 -- May 2026" → 2026).
    // "Aug 2022 -- TODO" has no end year yet, so nothing is filled.
    const dates = plain[3] || ''
    const parts = dates.split(/\s*(?:--|–|—|-|to)\s*/i)
    const end = parts.length > 1 ? parts[parts.length - 1] : dates
    const year = /\b(19|20)\d{2}\b/.exec(end)
    if (year && !/TODO|present|current/i.test(end)) out.graduation_year = year[0]
  }
  for (const k of Object.keys(out) as (keyof Profile)[]) if (!out[k]) delete out[k]
  return out
}

/**
 * Copy resume details into empty profile fields. Returns the fields filled.
 * Placeholders ("TODO", "XX") are never copied.
 */
export function fillProfileGaps(latex: string): (keyof Profile)[] {
  const settings = settingsStore.load()
  const derived = profileFromResume(latex)
  const patch: Partial<Profile> = {}
  for (const [k, v] of Object.entries(derived) as [keyof Profile, string][]) {
    if (!v || /\bTODO\b|\bXX+\b/i.test(v)) continue
    if (!String(settings.profile[k] ?? '').trim()) patch[k] = v
  }
  const keys = Object.keys(patch) as (keyof Profile)[]
  if (keys.length) settingsStore.save({ profile: { ...settings.profile, ...patch } })
  return keys
}
