/**
 * Details the label-based parser misses, read with the same description
 * reader the career-page jobs use (lib/jobs/analyze.ts):
 *
 *   experience  "0–2 years of relevant experience" in the body → "0–2 yrs"
 *   skills      technologies mentioned anywhere in the post
 *   work mode   remote / hybrid / on-site
 *   job type    internship / full-time / contract …
 *   pay         when there's no CTC/Stipend line
 *
 * Only fills gaps: what the post states on a labelled line always wins.
 */
import { analyzeJd } from '@/lib/jobs/analyze'

import type { ParsedExtra } from '@/lib/types'

export interface PostDetails {
  experience: string | null
  salary: string | null
  extra: ParsedExtra
}

export function enrichPost(text: string, title: string | null, current: { experience: string | null; salary: string | null; extra: ParsedExtra | null }): PostDetails {
  const a = analyzeJd(title || '', text || '')
  const extra: ParsedExtra = { ...(current.extra || {}) }
  let experience = current.experience
  if (!experience && a.experience) {
    const e = a.experience
    experience = e.text === 'entry level' ? 'Freshers' : e.max !== null ? `${e.min}–${e.max} yrs` : `${e.min}+ yrs`
  }
  const skills = [...a.required, ...a.preferred]
  if (skills.length && !extra.skills_list?.length) extra.skills_list = skills.slice(0, 10)
  if (!extra.work_mode && a.details.work_mode) extra.work_mode = a.details.work_mode
  if (!extra.job_type && a.details.employment_type) extra.job_type = a.details.employment_type
  const salary = current.salary || a.details.salary || null
  return { experience, salary, extra }
}
