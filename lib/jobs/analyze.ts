/**
 * Deterministic job-description analysis: required vs preferred skills,
 * experience range, seniority and the top keywords. Feeds the relevance score,
 * the resume tailoring prompt and the ATS coverage report.
 */
import type { Seniority } from '@/lib/types'

import { extractSkills } from './skills'

export interface JdAnalysis {
  required: string[]
  preferred: string[]
  keywords: string[]
  experience: { min: number; max: number | null; text: string } | null
  seniority: Seniority | null
}

const PREFERRED_HEAD =
  /^\s*(?:[-*•#]+\s*)?(preferred|nice[- ]to[- ]have|bonus|good to have|pluses|desired|additional|preferred qualifications|it'?s a plus|what would make you stand out)\b/i
const REQUIRED_HEAD =
  /^\s*(?:[-*•#]+\s*)?(requirements|required|qualifications|minimum qualifications|basic qualifications|what you('ll)? (need|bring)|must[- ]have|who you are|you have|skills)\b/i

/** Split a JD into required-ish and preferred-ish text by its headings. */
export function splitSections(text: string): { required: string; preferred: string } {
  const lines = (text || '').split(/\r?\n/)
  let mode: 'required' | 'preferred' = 'required'
  const req: string[] = []
  const pref: string[] = []
  for (const raw of lines) {
    // A one-paragraph JD ("…Java, SQL. Nice to have: Kafka.") — split the line
    // at the marker so only what follows it counts as preferred.
    const marker = /\b(nice[- ]to[- ]have|preferred qualifications|bonus points|good to have|it'?s a plus)\b/i.exec(raw)
    if (raw.length >= 80 && marker && marker.index > 0) {
      ;(mode === 'preferred' ? pref : req).push(raw.slice(0, marker.index))
      pref.push(raw.slice(marker.index))
      mode = 'preferred'
      continue
    }
    const line = raw
    if (line.length < 80 && PREFERRED_HEAD.test(line)) mode = 'preferred'
    else if (line.length < 80 && REQUIRED_HEAD.test(line)) mode = 'required'
    // Inline markers move a single line: "Experience with Kafka is a plus."
    const inlinePreferred = /\b(is a plus|is an advantage|nice to have|preferred|bonus)\b/i.test(line)
    ;(mode === 'preferred' || inlinePreferred ? pref : req).push(line)
  }
  return { required: req.join('\n'), preferred: pref.join('\n') }
}

const NUM_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

/** "2-4 years", "3+ yrs", "at least five years", "0 to 1 year", "new grad". */
export function parseExperience(text: string): JdAnalysis['experience'] {
  const t = (text || '').toLowerCase().replace(/[–—]/g, '-')
  const num = '(\\d{1,2}(?:\\.\\d)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)'
  const toN = (s: string): number => (s in NUM_WORDS ? NUM_WORDS[s] : Number.parseFloat(s))
  const range = new RegExp(`${num}\\s*(?:-|to)\\s*${num}\\s*\\+?\\s*(?:years?|yrs?)`, 'i').exec(t)
  if (range) {
    const a = toN(range[1])
    const b = toN(range[2])
    if (a <= b && b <= 40) return { min: a, max: b, text: range[0] }
  }
  const plus = new RegExp(
    `(?:at least|minimum(?: of)?|min\\.?|over)?\\s*${num}\\s*(\\+|plus)?\\s*(?:years?|yrs?)(?:\\s+of)?(?:\\s+\\w+){0,4}\\s+(?:experience|exp)`,
    'i',
  ).exec(t)
  if (plus) {
    const a = toN(plus[1])
    if (a <= 40) return { min: a, max: null, text: plus[0].trim() }
  }
  if (/\b(new grad|new graduate|fresh(er|ers)?|entry[- ]level|recent graduate|campus|graduate program|0 years)\b/.test(t)) {
    return { min: 0, max: 1, text: 'entry level' }
  }
  return null
}

export function detectSeniority(title: string): Seniority | null {
  const t = (title || '').toLowerCase()
  if (/\b(intern|internship|trainee|apprentice|co-?op)\b/.test(t)) return 'intern'
  if (/\b(new grad|graduate|fresher|entry[- ]level|campus|university grad)\b/.test(t)) return 'new_grad'
  if (/\b(senior|sr\.?|staff|principal|lead|director|head|vp|architect|manager|distinguished)\b/.test(t)) return 'senior'
  // An explicit level ("II", "III", "L2") wins over words like "Associate",
  // which is often a team name ("SDE III, Associate Experience").
  if (/\b(ii|2|l2|sde[- ]?2|sde[- ]?ii|iii|3|mid)\b/.test(t)) return 'mid'
  if (/\b(junior|jr\.?|associate)\b/.test(t) || /\b(i|1|l1|sde[- ]?1|sde[- ]?i|engineer i)\b/.test(t)) return 'junior'
  return null
}

const STOP = new Set(
  ('a an and are as at be by for from has have in is it its of on or our that the to we will with you your ' +
    'this they their them about across all also any can who what when where which work working team teams ' +
    'role roles join us experience years year strong ability skills including such other more new using ' +
    'help build building based must should may well within into etc per like over both each') .split(' '),
)

/** Most frequent meaningful single words and bigrams, skills first. */
export function topKeywords(text: string, limit = 25): string[] {
  const words = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
  const counts = new Map<string, number>()
  for (let i = 0; i < words.length; i++) {
    counts.set(words[i], (counts.get(words[i]) ?? 0) + 1)
    if (i + 1 < words.length) {
      const bg = `${words[i]} ${words[i + 1]}`
      counts.set(bg, (counts.get(bg) ?? 0) + 0.8)
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 1.6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w)
}

export function analyzeJd(title: string, text: string): JdAnalysis {
  const { required, preferred } = splitSections(text)
  const pref = new Set(extractSkills(preferred))
  // A skill listed in both counts as required.
  const reqSet = new Set(extractSkills(`${title}\n${required}`))
  return {
    required: [...reqSet].sort(),
    preferred: [...pref].filter((s) => !reqSet.has(s)).sort(),
    keywords: topKeywords(text),
    experience: parseExperience(text),
    seniority: detectSeniority(title),
  }
}
