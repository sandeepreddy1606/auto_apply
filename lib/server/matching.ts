/**
 * Job-title matching rules used by the career-page scanner.
 *
 * Kept separate from scanner.ts so these stay pure — no network, no database —
 * which is what makes them directly testable against the Python original.
 */
import type { Profile } from '@/lib/types'

const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'etc', 'using', 'good',
  'strong', 'knowledge', 'experience', 'years', 'skills'])
const SHORT_OK = new Set(['go', 'qa', 'ml', 'ai', 'ui', 'ux', 'js', 'ts', 'c#',
  'c', 'r', 'bi', 'db', 'os'])
const SENIOR_RE =
  /\b(senior|sr\.?|staff|principal|lead|director|head|vp|vice president|architect|distinguished)\b/i
const JUNIOR_RE =
  /\b(intern(ship)?|trainee|fresher|junior|jr\.?|graduate|apprentice|entry[- ]level)\b/i

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildKeywords(
  profile: Partial<Profile>,
  extraKeywords = '',
): Set<string> {
  const raw: string[] = [
    ...(profile.skills || '').split(/[,;/|\n]/),
    ...(extraKeywords || '').split(/[,;/|\n]/),
  ]
  const role = (profile.current_role || '').trim()
  if (role) {
    raw.push(role) // full phrase, e.g. "frontend developer"
    raw.push(...role.split(/\s+/)) // plus its words, e.g. "frontend"
  }
  const kws = new Set<string>()
  for (const item of raw) {
    const k = item.trim().toLowerCase().replace(/\.+$/, '')
    if (!k || STOPWORDS.has(k)) continue
    if (k.length < 3 && !SHORT_OK.has(k)) continue
    kws.add(k)
  }
  return kws
}

export function profileYears(profile: Partial<Profile>): number | null {
  const m = /\d+(\.\d+)?/.exec(profile.experience_years || '')
  return m ? Number.parseFloat(m[0]) : null
}

/** Returns [matched, reason]. Keyword hit first, then a seniority sanity check. */
export function matchTitle(
  title: string,
  keywords: Set<string>,
  years: number | null,
): [boolean, string | null] {
  const t = (title || '').toLowerCase()
  const hits: string[] = []
  for (const k of keywords) {
    if (k.includes(' ') || k.length > 14) {
      if (t.includes(k)) hits.push(k)
    } else if (new RegExp(`(?<![a-z0-9+#.])${escapeRe(k)}(?![a-z0-9+#])`).test(t)) {
      hits.push(k)
    }
  }
  if (!hits.length) return [false, null]
  if (years !== null) {
    if (years < 4 && SENIOR_RE.test(title) && !JUNIOR_RE.test(title)) {
      return [false, 'seniority above your experience']
    }
    if (years >= 3 && JUNIOR_RE.test(title)) {
      return [false, 'below your experience level']
    }
  }
  return [true, hits.sort().slice(0, 6).join(', ')]
}
