/**
 * Rule-based (regex + heuristics) parser for job-posting messages.
 *
 * No AI/LLM involved: extraction relies on label patterns ("Role:", "CTC:"...),
 * keyword heuristics for job titles, and regexes for emails / Google Form links.
 *
 * Ported 1:1 from the Python original. Where Python and JS regex semantics
 * differ the difference is called out inline — notably `re.match` (anchored at
 * the start) becomes an explicit `^`, and `str.strip(chars)` becomes stripChars.
 */
import crypto from 'node:crypto'

import type { ApplyMethod, ParsedExtra } from '@/lib/types'

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const GFORM_RE =
  /https?:\/\/(?:docs\.google\.com\/forms\/[^\s)\]>"'<]+|forms\.gle\/[^\s)\]>"'<]+)/gi
// Python's GFORM_RE.match() anchors at the start of the string; JS needs that spelled out.
const GFORM_ANCHORED =
  /^https?:\/\/(?:docs\.google\.com\/forms\/[^\s)\]>"'<]+|forms\.gle\/[^\s)\]>"'<]+)/i
const URL_RE = /https?:\/\/[^\s)\]>"'<]+/g

// Symbols/emoji commonly decorating telegram job posts. The Python character
// class is reproduced exactly: emoji planes, misc symbols, regional indicators,
// arrows, plus the variation selector / ZWJ / bullet characters.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}\u{2022}\u{25AA}\u{25CF}]+/gu

const ROLE_KEYWORDS = [
  'developer', 'engineer', 'intern', 'internship', 'analyst', 'designer',
  'manager', 'tester', 'qa', 'sde', 'architect', 'consultant', 'scientist',
  'administrator', 'devops', 'full stack', 'fullstack', 'frontend',
  'front end', 'backend', 'back end', 'programmer', 'lead', 'executive',
  'specialist', 'associate', 'trainee', 'recruiter', 'support',
]

/** label -> list of line-prefix labels ("Label : value") */
const FIELD_LABELS: Record<string, string[]> = {
  job_title: ['job role', 'job title', 'role', 'position', 'profile',
    'designation', 'post', 'opening', 'hiring for', 'title', 'job profile'],
  company: ['company name', 'company', 'organization', 'organisation',
    'firm', 'employer', 'client'],
  location: ['work location', 'job location', 'location', 'city', 'place',
    'base location'],
  experience: ['experience required', 'experience', 'exp', 'yoe',
    'years of experience'],
  salary: ['salary', 'ctc', 'package', 'stipend', 'compensation', 'pay',
    'budget', 'salary range'],
  batch: ['batch', 'passout year', 'pass out', 'eligible batch'],
  qualification: ['qualification', 'education', 'eligibility', 'degree'],
  skills: ['skills required', 'skill set', 'skills', 'tech stack',
    'technologies', 'must have'],
  notice_period: ['notice period', 'joining', 'np'],
  job_type: ['job type', 'employment type', 'work mode', 'mode', 'type'],
  deadline: ['last date', 'deadline', 'apply by', 'apply before'],
}

const EXTRA_FIELDS = ['batch', 'qualification', 'skills', 'notice_period',
  'job_type', 'deadline'] as const

/** Lines that introduce an application link ("How to Apply:", "Apply Link -", …). */
const APPLY_INTRO_RE =
  /\b(how\s+to\s+apply|apply\s+link|application\s+link|apply\s+here|apply\s+now|apply\s+at|to\s+apply|register\s+(?:here|at)|apply)\b/i

const SUBJECT_PATTERNS = [
  /subject\s*line\s*[:\-–]?\s*["“']?(.+?)["”']?\s*$/i,
  /(?:mention|use|put|write)\s+["“'](.+?)["”']\s+(?:as|in)\s+(?:the\s+)?subject/i,
  /subject\s*[:\-–]\s*["“']?(.+?)["”']?\s*$/i,
]

// Forwarded referral posts frequently arrive with their newlines stripped, so
// every "Label - value" runs together on one line. Re-insert a break before each
// known label (and the apply-intro phrases) so line-based extraction works.
const SPLIT_LABELS = [
  'company', 'role', 'batch', 'stipend', 'ctc', 'salary', 'package',
  'location', 'experience', 'qualifications', 'qualification', 'eligibility',
  'skills', 'deadline', 'notice period', 'job type', 'employment type',
  'work mode', 'designation', 'position', 'department', 'duration',
  'how to apply', 'apply link', 'apply here', 'apply now', 'jd',
  'must have', 'good to have', 'responsibilities', 'requirements',
  'description', 'about the role', "what you'll work on", 'what you will',
  'who can apply', 'perks', 'benefits', 'note', 'roles and responsibilities',
]

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SPLIT_RE = new RegExp(
  `\\s*(?=(?:${SPLIT_LABELS.map(escapeRe).join('|')})\\s*[-:–])`,
  'gi',
)

/** Python's str.strip(chars): trim any of `chars` from both ends. */
function stripChars(text: string, chars: string): string {
  const set = new Set(chars)
  let start = 0
  let end = text.length
  while (start < end && set.has(text[start])) start += 1
  while (end > start && set.has(text[end - 1])) end -= 1
  return text.slice(start, end)
}

const normalizeLines = (text: string): string => text.replace(SPLIT_RE, '\n')

function clean(text: string): string {
  let out = text.replace(EMOJI_RE, ' ')
  out = out.replaceAll('**', '').replaceAll('__', '').replaceAll('`', '')
  return stripChars(out.replace(/\s{2,}/g, ' '), ' \t*#->:•|–-')
}

const cleanValue = (value: string): string =>
  stripChars(clean(value), ' .;,').slice(0, 300)

function extractLabeledFields(lines: string[]): Record<string, string> {
  const found: Record<string, string> = {}
  for (const line of lines) {
    const stripped = clean(line)
    // Python precedence: `not stripped or (no ':' and no '-' and no '–')`.
    if (!stripped || (!line.includes(':') && !line.includes('-') && !line.includes('–'))) {
      continue
    }
    const m =
      /^\s*([^:\-–]{1,40}?)\s*[:\-–]\s+?(.+)$/.exec(stripped) ||
      /^\s*([^:]{1,40}?)\s*:\s*(.+)$/.exec(stripped)
    if (!m) continue
    const label = m[1].trim().toLowerCase()
    const value = m[2].trim()
    if (!value) continue
    for (const [field, labels] of Object.entries(FIELD_LABELS)) {
      if (field in found) continue
      const hit = labels.some(
        (lab) =>
          label === lab ||
          label.endsWith(` ${lab}`) ||
          label.startsWith(`${lab} `) ||
          label === lab.replace(/s+$/, ''),
      )
      if (hit) {
        found[field] = cleanValue(value)
        break
      }
    }
  }
  return found
}

function guessJobTitle(lines: string[]): string | null {
  // Patterns like "Hiring for X", "We are hiring X", "X required/needed/wanted"
  const joined = lines.join('\n')
  const patterns = [
    /(?:hiring\s+for|we\s+are\s+hiring|urgently\s+hiring|opening\s+for|looking\s+for|requirement\s+for|vacancy\s+for)\s*[:\-–]?\s*(?:an?\s+)?([^\n,.!]{3,80})/i,
    /([^\n,.!]{3,80}?)\s+(?:required|needed|wanted|vacancy|opening)\b/i,
  ]
  for (const pat of patterns) {
    const m = pat.exec(joined)
    if (m) {
      const candidate = cleanValue(m[1])
      if (candidate && ROLE_KEYWORDS.some((k) => candidate.toLowerCase().includes(k))) {
        return candidate
      }
    }
  }

  // Otherwise: earliest short-ish line containing a role keyword.
  for (const line of lines.slice(0, 10)) {
    const cleaned = clean(line)
    const low = cleaned.toLowerCase()
    if (!cleaned || cleaned.length > 80 || cleaned.includes('@') || low.includes('http')) {
      continue
    }
    if (ROLE_KEYWORDS.some((k) => low.includes(k))) {
      return cleanValue(
        cleaned.replace(
          /^(?:urgent(?:ly)?\s*|hiring\s*|we\s*are\s*hiring\s*|job\s*alert\s*|new\s*opening\s*|vacancy\s*)[:\-–]?\s*/i,
          '',
        ),
      )
    }
  }
  return null
}

function extractSubjectHint(lines: string[]): string | null {
  for (const line of lines) {
    const cleaned = clean(line)
    if (!cleaned.toLowerCase().includes('subject')) continue
    for (const pat of SUBJECT_PATTERNS) {
      const m = pat.exec(cleaned)
      if (m) {
        const subject = stripChars(m[1], ' "\'“”.')
        if (subject.length > 2 && subject.length <= 150) return subject
      }
    }
  }
  return null
}

const findAll = (re: RegExp, text: string): string[] =>
  [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))]
    .map((m) => m[0])

/**
 * The URL the poster points to for applying. Prefers a link that sits on (or
 * just after) a 'How to Apply' / 'Apply Link' line, so a JD/description link
 * earlier in the post isn't mistaken for the application link.
 */
function extractApplyUrl(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (!APPLY_INTRO_RE.test(lines[i])) continue
    const same = findAll(URL_RE, lines[i])
    if (same.length) return stripChars(same[0], '.,;:!?')
    for (const nxt of lines.slice(i + 1, i + 4)) {
      const found = findAll(URL_RE, nxt)
      if (found.length) return stripChars(found[0], '.,;:!?')
    }
  }
  return null
}

/**
 * Split a message that lists several jobs into one chunk per opening.
 *
 * Referral posts usually repeat a leading label per role ("Company - …" or
 * "Role - …"). When such a label appears 2+ times we cut the message at each
 * occurrence; otherwise it's a single opening. Conservative on purpose — a
 * wrong split is worse than leaving a post whole.
 */
export function splitOpenings(text: string): string[] {
  const lines = normalizeLines(text).split('\n')

  const starts = (pattern: string): number[] => {
    const rx = new RegExp(`^\\s*(?:${pattern})\\s*[-:–]`, 'i')
    return lines.reduce<number[]>((acc, ln, i) => {
      if (rx.test(ln)) acc.push(i)
      return acc
    }, [])
  }

  const company = starts('company|organi[sz]ation|employer')
  const role = starts('role|position|profile|designation|opening|post')

  let prefix = ''
  let bounds: number[]
  if (company.length >= 2) {
    bounds = company
  } else if (role.length >= 2) {
    bounds = role
    // If the company is stated once above the first role, share it with each.
    const header = lines.slice(0, role[0]).join('\n')
    if (/^\s*(?:company|organi[sz]ation|employer)\s*[-:–]/im.test(header)) {
      prefix = `${header.trim()}\n`
    }
  } else {
    return [text]
  }

  const segments: string[] = []
  const ends = [...bounds.slice(1), lines.length]
  for (let i = 0; i < bounds.length; i += 1) {
    let seg = lines.slice(bounds[i], ends[i]).join('\n').trim()
    if (prefix) seg = prefix + seg
    if (seg.length >= 15) segments.push(seg)
  }

  // Guard against pathological splits; fall back to the whole message.
  if (segments.length < 2 || segments.length > 25) return [text]
  return segments
}

export function textHash(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex')
}

export interface ParsedMessage {
  method: ApplyMethod
  email_to: string | null
  all_emails: string[]
  form_url: string | null
  all_form_urls: string[]
  apply_url: string | null
  other_urls: string[]
  job_title: string | null
  company: string | null
  location: string | null
  experience: string | null
  salary: string | null
  subject_hint: string | null
  extra: ParsedExtra
}

/** Parse a job posting into structured fields. Pure rules, no AI. */
export function parseMessage(text: string): ParsedMessage {
  const normalized = normalizeLines(text)
  const lines = normalized.split('\n').filter((l) => l.trim())

  const emails: string[] = []
  for (const raw of findAll(EMAIL_RE, text)) {
    const e = stripChars(raw, '.,;:')
    if (!emails.some((x) => x.toLowerCase() === e.toLowerCase())) emails.push(e)
  }

  const formUrls: string[] = []
  for (const raw of findAll(GFORM_RE, text)) {
    const u = stripChars(raw, '.,;:!?')
    if (!formUrls.includes(u)) formUrls.push(u)
  }

  const otherUrls = findAll(URL_RE, text)
    .map((u) => stripChars(u, '.,;:!?'))
    .filter((u) => !GFORM_ANCHORED.test(u))

  const fields = extractLabeledFields(lines)
  if (!('job_title' in fields)) {
    const guess = guessJobTitle(lines)
    if (guess) fields.job_title = guess
  }

  const subjectHint = extractSubjectHint(lines)
  const applyUrlHint = extractApplyUrl(lines)

  // Priority: an auto-fillable Google Form, then an HR email, then a plain
  // external application link (company career page / Workday / MS Forms — we
  // can't auto-submit those but we surface the link so the user applies fast).
  let method: ApplyMethod
  let applyUrl: string | null = null
  if (formUrls.length) {
    method = 'gform'
  } else if (emails.length) {
    method = 'email'
  } else if (otherUrls.length) {
    method = 'link'
    applyUrl =
      applyUrlHint && !GFORM_ANCHORED.test(applyUrlHint) ? applyUrlHint : otherUrls[0]
  } else {
    method = 'unknown'
  }

  const extra: ParsedExtra = {}
  for (const k of EXTRA_FIELDS) {
    if (fields[k]) extra[k] = fields[k]
  }

  return {
    method,
    email_to: emails[0] ?? null,
    all_emails: emails,
    form_url: formUrls[0] ?? null,
    all_form_urls: formUrls,
    apply_url: applyUrl,
    other_urls: otherUrls.slice(0, 10),
    job_title: fields.job_title ?? null,
    company: fields.company ?? null,
    location: fields.location ?? null,
    experience: fields.experience ?? null,
    salary: fields.salary ?? null,
    subject_hint: subjectHint,
    extra,
  }
}
