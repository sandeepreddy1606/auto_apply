/**
 * Deterministic job-description analysis: required vs preferred skills,
 * experience, seniority, education, job type, work mode, pay, visa and the
 * top keywords. Feeds the relevance score, the job page, the resume-tailoring
 * prompt and the ATS coverage report. Pure: safe in client code and tests.
 */
import type { Seniority } from '@/lib/types'

import { extractSkills } from './skills'

export interface ExperienceReq {
  min: number
  max: number | null
  /** The phrase it came from, for display ("3+ years of software development"). */
  text: string
}

export interface JdDetails {
  education: { level: 'phd' | 'masters' | 'bachelors' | 'diploma' | null; fields: string[]; equivalent: boolean; text: string } | null
  employment_type: 'full-time' | 'part-time' | 'contract' | 'internship' | 'temporary' | null
  work_mode: 'remote' | 'hybrid' | 'onsite' | null
  salary: string | null
  visa: 'sponsors' | 'no-sponsorship' | null
  notice: string | null
  shift: string | null
  travel: string | null
}

export interface JdAnalysis {
  required: string[]
  preferred: string[]
  keywords: string[]
  experience: ExperienceReq | null
  /** A higher bar from the preferred section, when there is one ("5+ years preferred"). */
  experience_preferred: ExperienceReq | null
  seniority: Seniority | null
  details: JdDetails
}

const PREFERRED_HEAD =
  /^\s*(?:[-*•#]+\s*)?(preferred|nice[- ]to[- ]have|bonus|good to have|pluses|desired|additional|preferred qualifications|it'?s a plus|what would make you stand out|ideally)\b/i
const REQUIRED_HEAD =
  /^\s*(?:[-*•#]+\s*)?(requirements|required|qualifications|minimum qualifications|basic qualifications|what you('ll)? (need|bring)|must[- ]have|who you are|you have|skills|eligibility|key skills)\b/i
const OTHER_HEAD = /^\s*(?:[-*•#]+\s*)?(about (us|the (team|company|role))|who we are|what we offer|benefits|perks|our (culture|values)|equal opportunity|responsibilities|what you'?ll do|key responsibilities)\b/i

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
    else if (line.length < 80 && (REQUIRED_HEAD.test(line) || OTHER_HEAD.test(line))) mode = 'required'
    // Inline markers move a single line: "Experience with Kafka is a plus."
    const inlinePreferred = /\b(is a plus|is an advantage|nice to have|preferred|bonus)\b/i.test(line)
    ;(mode === 'preferred' || inlinePreferred ? pref : req).push(line)
  }
  return { required: req.join('\n'), preferred: pref.join('\n') }
}

/** The qualifications part only (where experience lines live), when the JD has headed sections. */
function qualificationsText(text: string): string | null {
  const lines = (text || '').split(/\r?\n/)
  const out: string[] = []
  let on = false
  for (const l of lines) {
    if (l.length < 80 && /\b(qualifications|requirements|what you('ll)? (need|bring)|must[- ]have|who you are|you have|eligibility|skills (and|&) experience|experience required)\b/i.test(l)) on = true
    else if (l.length < 80 && OTHER_HEAD.test(l)) on = false
    if (on) out.push(l)
  }
  return out.length ? out.join('\n') : null
}

// ---------- experience ----------

const NUM_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
}
const N = '(\\d{1,2}(?:\\.\\d)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)'
const Y = '(?:years?|yrs?)'
const toN = (s: string): number => (s in NUM_WORDS ? NUM_WORDS[s] : Number.parseFloat(s))

interface Cand { min: number; max: number | null; text: string; at: number; strong: boolean }

/** Text after a match that means "this isn't a work-experience requirement". */
const NOT_EXPERIENCE_AFTER = /^\s*(old|of age|ago|warranty|guarantee|degree|program|programme|contract|plan|vision|roadmap|journey|of (college|university|study|education|schooling|undergraduate|history|operation|growth)|in business|anniversary|to come)\b/i
const NOT_EXPERIENCE_BEFORE = /(within|in the (last|past|next)|for the (next|first|last)|multi-?|each|every|per|over the (last|past|next)|up to|age(d)?|founded|since)\s*$/i

function experienceCandidates(raw: string): Cand[] {
  const t = (raw || '').toLowerCase().replace(/[–—−]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  const out: Cand[] = []
  const push = (m: RegExpExecArray, min: number, max: number | null, strong: boolean) => {
    if (!(min >= 0 && min <= 30) || (max !== null && (max < min || max > 40))) return
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40)
    const before = t.slice(Math.max(0, m.index - 24), m.index)
    if (NOT_EXPERIENCE_AFTER.test(after) || NOT_EXPERIENCE_BEFORE.test(before)) return
    // "4-year degree" / "4 year program"
    if (/^\s*-?\s*year\b/.test(m[0]) && /degree|program/.test(after)) return
    // Display text: the phrase plus what it's about, cut at the clause end.
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 110).split(/[.;,(\n•]|\s-\s|\bor\b|\band\b/)[0]
    const cut = tail.length <= 70 ? tail : tail.slice(0, 70).replace(/\s+\S*$/, '')
    const shown = `${m[0]}${cut}`.trim().replace(/\s+(in|of|with|as|at|on|to|for|the|a|an)$/i, '')
    out.push({ min, max, text: shown.replace(/\s+/g, ' '), at: m.index, strong })
  }
  const run = (re: RegExp, f: (m: RegExpExecArray) => void) => {
    for (const m of t.matchAll(new RegExp(re.source, 'gi'))) f(m as RegExpExecArray)
  }
  // 2-4 years, 2 to 4 yrs, 2-4+ years
  run(new RegExp(`\\b${N}\\s*(?:-|to)\\s*${N}\\s*\\+?\\s*${Y}`), (m) => push(m, toN(m[1]), toN(m[2]), true))
  // 3+ years, 3 plus years, 3 or more years, 3 years or more / and above
  run(new RegExp(`\\b${N}\\s*(?:\\+|plus|or more|and above)\\s*${Y}`), (m) => push(m, toN(m[1]), null, true))
  run(new RegExp(`\\b${N}\\s*${Y}\\s*(?:or more|and above|\\+)`), (m) => push(m, toN(m[1]), null, true))
  // at least / minimum (of) / over / more than 3 years
  run(new RegExp(`\\b(?:at least|atleast|minimum(?: of)?|min\\.?|over|more than|upwards of|no less than)\\s*${N}\\s*\\+?\\s*${Y}`), (m) => push(m, toN(m[1]), null, true))
  // experience: 3 years / experience of 2-4 years / exp - 3 yrs
  run(new RegExp(`\\b(?:experience|exp\\.?)\\s*(?:required|needed|level|range)?\\s*(?::|-|of|:-)?\\s*${N}\\s*(?:(?:-|to)\\s*${N})?\\s*\\+?\\s*${Y}`), (m) =>
    push(m, toN(m[1]), m[2] ? toN(m[2]) : null, true),
  )
  // 3 years of X / 3 years' experience / 2 years in / 2 years working with
  run(new RegExp(`\\b${N}\\s*${Y}'?s?\\s+(?:of|in|as|with|working|hands-on|relevant|professional|industry|industrial|experience|exp\\b|post|full-time)`), (m) => {
    const window = t.slice(m.index, m.index + 160)
    if (/experience|exp\b|working|developing|building|programming|hands-on|professional|industry|engineering|development|design|managing|leading|using/.test(window)) push(m, toN(m[1]), null, false)
  })
  // 6+ months of experience
  run(new RegExp(`\\b(\\d{1,2})\\s*\\+?\\s*(?:months?|mos)\\s+(?:of\\s+)?(?:\\w+\\s+){0,4}(?:experience|internship)`), (m) => push(m, Math.round((Number(m[1]) / 12) * 10) / 10, null, true))
  return out.sort((a, b) => a.at - b.at)
}

/** In a qualifications list the first requirement is the headline one; in free text, explicit phrasings win. */
function pick(cands: Cand[], preferStrong = false): ExperienceReq | null {
  const c = (preferStrong ? cands.find((x) => x.strong) : null) ?? cands[0]
  return c ? { min: c.min, max: c.max, text: c.text } : null
}

/**
 * Required experience: "2-4 years", "3+ yrs", "at least five years",
 * "3+ years of non-internship professional software development experience",
 * "Experience: 2 to 4 years", "6+ months", "new grad". Prefers the
 * qualifications section; ignores "multi-year roadmap", "each year", age, degrees.
 */
export function parseExperience(text: string): ExperienceReq | null {
  const quals = qualificationsText(text)
  const fromQuals = quals ? pick(experienceCandidates(splitSections(quals).required || quals)) : null
  if (fromQuals) return fromQuals
  const { required } = splitSections(text)
  const r = pick(experienceCandidates(required), true) ?? pick(experienceCandidates(text), true)
  if (r) return r
  if (/\b(new grad|new graduate|fresh(er|ers)?|entry[- ]level|recent graduate|campus hire|graduate program|0 years|no experience required|early career)\b/i.test(text || '')) {
    return { min: 0, max: 1, text: 'entry level' }
  }
  return null
}

function parsePreferredExperience(text: string, req: ExperienceReq | null): ExperienceReq | null {
  const p = pick(experienceCandidates(splitSections(text).preferred), true)
  return p && (!req || p.min > req.min) ? p : null
}

// ---------- other details ----------

const FIELD_RE: [RegExp, string][] = [
  [/computer science|\bcs\b|computer engineering|\bcse\b/i, 'Computer Science'],
  [/information technology|\bit\b(?= or| and|,)/i, 'Information Technology'],
  [/electrical|electronics|\bece\b|\beee\b/i, 'Electrical/Electronics'],
  [/mathematics|\bmath\b|applied math/i, 'Mathematics'],
  [/statistics/i, 'Statistics'],
  [/data science/i, 'Data Science'],
  [/physics/i, 'Physics'],
  [/mechanical/i, 'Mechanical'],
  [/business|\bmba\b|commerce|finance|economics/i, 'Business/Finance'],
  [/(engineering|technical) (discipline|field)|\bengineering\b/i, 'Engineering'],
]

export function parseEducation(text: string): JdDetails['education'] {
  const t = (text || '').replace(/[’]/g, "'")
  const sentences = t.split(/(?<=[.;])\s+|\n/).filter((s) => /\b(degree|bachelor|master|ph\.?d|doctorate|b\.?\s?tech|m\.?\s?tech|b\.?e\b|b\.?sc|m\.?sc|\bbs\b|\bms\b|\bba\b|mba|graduate|diploma)\b/i.test(s))
  if (!sentences.length) return null
  const s = sentences.join(' ')
  const has = (re: RegExp) => re.test(s)
  const levels: NonNullable<JdDetails['education']>['level'][] = []
  if (has(/\b(bachelor'?s?|b\.?\s?tech|b\.?e\.?\b|b\.?sc|\bbs\b|\bba\b|undergraduate degree|graduate degree in|4-year degree|degree in)\b/i)) levels.push('bachelors')
  if (has(/\b(master'?s?|m\.?\s?tech|m\.?sc|\bms\b|\bm\.?s\.?\b|mba|advanced degree|post-?graduate)\b/i)) levels.push('masters')
  if (has(/\b(ph\.?\s?d|doctorate|doctoral)\b/i)) levels.push('phd')
  if (has(/\bdiploma\b/i)) levels.push('diploma')
  // The minimum is the lowest level asked for ("Bachelor's or Master's" → bachelor's).
  const order = ['diploma', 'bachelors', 'masters', 'phd'] as const
  const level = order.find((l) => levels.includes(l)) ?? null
  const fields = [...new Set(FIELD_RE.filter(([re]) => re.test(s)).map(([, f]) => f))].slice(0, 4)
  const equivalent = /\bor equivalent\b|equivalent (practical )?experience|or related field/i.test(s)
  const shown = sentences[0].replace(/^[-*•\s]+/, '').trim()
  return { level, fields, equivalent, text: shown.length > 160 ? `${shown.slice(0, 157)}…` : shown }
}

export function parseDetails(title: string, text: string): JdDetails {
  const t = `${title}\n${text || ''}`
  const lower = t.toLowerCase()
  // The title decides first ("… Intern", "(Fixed Term Contract)"); the text only
  // when it says so about this role — "non-internship experience" is not an internship.
  const typeOf = (x: string): JdDetails['employment_type'] => {
    if (/\b(contract|contractor|fixed[- ]term|c2h|contract[- ]to[- ]hire)\b/.test(x)) return 'contract'
    if (/(?<!non-)(?<!non )\b(intern|internship)\b(?! experience)/.test(x)) return 'internship'
    if (/\bpart[- ]time\b/.test(x)) return 'part-time'
    if (/\b(temporary|temp role|seasonal)\b/.test(x)) return 'temporary'
    return null
  }
  const lowerText = (text || '').toLowerCase()
  let employment_type: JdDetails['employment_type'] = typeOf((title || '').toLowerCase())
  if (!employment_type) {
    if (/\b(this is an? (paid )?internship|internship (program|programme|role|position|duration)|\d+[- ]month internship|internship of \d+)\b/.test(lowerText)) employment_type = 'internship'
    else if (/\b(this is a (fixed[- ]term|contract)|contract (role|position|duration)|fixed[- ]term contract|contract[- ]to[- ]hire)\b/.test(lowerText)) employment_type = 'contract'
    else if (/\b(this is a part[- ]time|part[- ]time (role|position))\b/.test(lowerText)) employment_type = 'part-time'
    else if (/\b(full[- ]time|permanent (role|position))\b/.test(lowerText)) employment_type = 'full-time'
  }

  let work_mode: JdDetails['work_mode'] = null
  if (/\bhybrid\b/.test(lower)) work_mode = 'hybrid'
  else if (/\b(fully remote|remote[- ]first|100% remote|work from home|wfh|remote (role|position|job|work|opportunity)|this (role|position) is remote|\(remote\)|- remote\b|remote,|remote$)/m.test(lower)) work_mode = 'remote'
  else if (/\b(on-?site|in[- ]office|work from office|wfo|office[- ]based|5 days (a week )?(in|from) (the )?office)\b/.test(lower)) work_mode = 'onsite'

  const salaryRe =
    /((?:₹|rs\.?\s?|inr\s?|\$|usd\s?|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(?:lpa|lakhs?|crores?|cr|k|l|m)?\b(?:\s*(?:-|to)\s*(?:₹|rs\.?\s?|inr\s?|\$|usd\s?|€|£)?\s?\d[\d,]*(?:\.\d+)?\s?(?:lpa|lakhs?|crores?|cr|k|l|m)?\b)?(?:\s*(?:per|\/|a)\s*(?:year|annum|yr|month|mo|hour|hr))?|\b\d{1,2}(?:\.\d)?\s*(?:-|to)\s*\d{1,2}(?:\.\d)?\s*(?:lpa|lakhs? per annum)\b|\b\d{1,2}(?:\.\d)?\s*lpa\b)/i
  const sm = salaryRe.exec(t.replace(/[–—]/g, '-'))
  const salary = sm && /\d{2}|lpa|lakh|k\b/i.test(sm[0]) ? sm[0].trim() : null

  let visa: JdDetails['visa'] = null
  if (/(not|unable to|cannot|can't|won't|will not|does not|do not)\s+(be able to\s+)?(provide|offer|sponsor|support)\w*\s*(\w+\s+){0,3}(visa|sponsorship|work authori)|no (visa )?sponsorship/i.test(lower)) visa = 'no-sponsorship'
  else if (/visa sponsorship (is )?(available|provided|offered)|(we|will) sponsor (visas?|work)/i.test(lower)) visa = 'sponsors'

  const notice = /\b(immediate joiners?|immediate(ly)? available|joining within \d+ (days|weeks)|notice period (of )?(up to |upto |less than |<\s*)?\d+ ?(days|weeks|months?))\b/i.exec(t)?.[0] ?? null
  const shift = /\b(night shifts?|rotational shifts?|us shifts?|uk shifts?|general shift|24x7|24\/7 support|weekend shifts?)\b/i.exec(t)?.[0] ?? null
  const travel = /\b(travel (up to|upto|of)? ?\d{1,3}\s?%|\d{1,3}\s?% travel|willing(ness)? to travel|extensive travel)\b/i.exec(t)?.[0] ?? null

  return { education: parseEducation(text), employment_type, work_mode, salary, visa, notice, shift, travel }
}

// ---------- seniority, keywords ----------

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
  const experience = parseExperience(text)
  return {
    required: [...reqSet].sort(),
    preferred: [...pref].filter((s) => !reqSet.has(s)).sort(),
    keywords: topKeywords(text),
    experience,
    experience_preferred: parsePreferredExperience(text, experience),
    seniority: detectSeniority(title),
    details: parseDetails(title, text),
  }
}

/** One-line, human summary of what a job asks for ("3+ yrs · Bachelor's (CS) · Full-time · Hybrid"). */
export function requirementsLine(a: Pick<JdAnalysis, 'experience' | 'details'>): string[] {
  const out: string[] = []
  if (a.experience) {
    out.push(a.experience.text === 'entry level' ? 'Entry level' : a.experience.max !== null ? `${a.experience.min}–${a.experience.max} yrs` : `${a.experience.min}+ yrs`)
  }
  const e = a.details.education
  if (e?.level) {
    const name = { phd: 'PhD', masters: "Master's", bachelors: "Bachelor's", diploma: 'Diploma' }[e.level]
    out.push(`${name}${e.fields[0] ? ` (${e.fields[0]})` : ''}${e.equivalent ? ' or equivalent' : ''}`)
  }
  if (a.details.employment_type) out.push(a.details.employment_type[0].toUpperCase() + a.details.employment_type.slice(1))
  if (a.details.work_mode) out.push(a.details.work_mode === 'onsite' ? 'On-site' : a.details.work_mode[0].toUpperCase() + a.details.work_mode.slice(1))
  if (a.details.salary) out.push(a.details.salary)
  return out
}
