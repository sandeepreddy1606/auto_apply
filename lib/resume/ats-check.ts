/**
 * ATS check on the compiled PDF's extracted text: contact details parse,
 * standard headings, no leftovers (TODO, LaTeX artifacts, broken glyphs),
 * page/size limits, and keyword coverage of the job description.
 */
import type { JdAnalysis } from '@/lib/jobs/analyze'
import { canonicalSkills, extractSkills } from '@/lib/jobs/skills'
import type { AtsCheck, AtsReport } from '@/lib/types'

export interface AtsInput {
  text: string
  pages: number
  sizeBytes: number
  maxPages: number
  contact: { name: string; email: string; phone: string }
  jd: JdAnalysis | null
  /** Skills coverage of the untailored base, for the before/after comparison. */
  baseText?: string | null
}

const HEADINGS: [string, RegExp][] = [
  ['Experience', /\b(work experience|experience|employment)\b/i],
  ['Education', /\beducation\b/i],
  ['Skills', /\b(technical skills|skills)\b/i],
]

export function coverage(text: string, jd: JdAnalysis | null): AtsReport['coverage'] & { _pct: number } {
  const have = new Set([...extractSkills(text), ...canonicalSkills([text])])
  const req = jd?.required ?? []
  const pref = jd?.preferred ?? []
  const rh = req.filter((s) => have.has(s))
  const ph = pref.filter((s) => have.has(s))
  const denom = req.length + 0.5 * pref.length
  const pct = denom ? Math.round(((rh.length + 0.5 * ph.length) / denom) * 100) : 100
  return {
    required_have: rh,
    required_missing: req.filter((s) => !have.has(s)),
    preferred_have: ph,
    preferred_missing: pref.filter((s) => !have.has(s)),
    pct,
    base_pct: null,
    _pct: pct,
  }
}

export function atsCheck(input: AtsInput): AtsReport {
  const checks: AtsCheck[] = []
  const t = input.text || ''
  const head = t.slice(0, 600)
  const push = (id: string, label: string, ok: boolean | 'warn', detail: string) =>
    checks.push({ id, label, status: ok === true ? 'pass' : ok === 'warn' ? 'warn' : 'fail', detail })

  push('text', 'Text is extractable', t.trim().length > 200, t.trim().length > 200 ? `${t.length} characters extracted` : 'Almost no text could be read from the PDF')

  const nameOk = !!input.contact.name && head.toLowerCase().includes(input.contact.name.toLowerCase().split(' ')[0])
  push('name', 'Name near the top', nameOk || 'warn', nameOk ? input.contact.name : 'Name not found in the first lines')

  const emailInText = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(head)?.[0]
  push('email', 'Email parses', !!emailInText, emailInText ? emailInText : 'No email address found in the header text')

  const digits = (s: string) => s.replace(/\D/g, '')
  const phoneOk = !!input.contact.phone && digits(head).includes(digits(input.contact.phone).slice(-10))
  push('phone', 'Phone parses', phoneOk || 'warn', phoneOk ? input.contact.phone : 'Phone number not found in the header text')

  for (const [label, re] of HEADINGS) {
    push(`heading_${label.toLowerCase()}`, `“${label}” heading`, re.test(t) || 'warn', re.test(t) ? 'Found' : 'Not found — ATS may not map this section')
  }

  const todo = /\bTODO\b/.test(t)
  push('todo', 'No TODO placeholders', !todo, todo ? 'The PDF still contains “TODO”' : 'Clean')

  const artifacts = /\\[a-zA-Z]{3,}|\{\}|�/.exec(t)
  push('artifacts', 'No LaTeX artifacts or broken glyphs', !artifacts || 'warn', artifacts ? `Found “${artifacts[0]}”` : 'Clean')

  // Ligature check: common words split by a missing glyph ("certi ed", "e cient").
  const broken = /\b(certi ed|e cient|con gur|speci c|work ow|o ce)\b|[ﬀﬁﬂﬃﬄ]/i.exec(t)
  push('ligatures', 'Ligatures extract correctly', !broken || 'warn', broken ? `Looks like “${broken[0]}” — add \\pdfgentounicode=1` : 'OK')

  push('pages', `At most ${input.maxPages} page${input.maxPages > 1 ? 's' : ''}`, input.pages <= input.maxPages || 'warn', `${input.pages} page${input.pages === 1 ? '' : 's'}`)
  const kb = Math.round(input.sizeBytes / 1024)
  push('size', 'File under 1 MB', kb < 1024 || 'warn', `${kb} KB`)

  const cov = coverage(t, input.jd)
  const base = input.baseText ? coverage(input.baseText, input.jd)._pct : null
  if (input.jd) {
    push('coverage', 'Job keyword coverage', cov.pct >= 60 || 'warn', `${cov.pct}%${base !== null ? ` (base ${base}%)` : ''}`)
  }

  const { _pct, ...coverageOut } = cov
  void _pct
  return {
    ok: !checks.some((c) => c.status === 'fail'),
    pages: input.pages,
    size_kb: kb,
    checks,
    coverage: { ...coverageOut, base_pct: base },
    text_preview: t.slice(0, 4000),
  }
}
