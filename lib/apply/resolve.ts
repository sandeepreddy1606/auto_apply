/**
 * Answer resolution chain for application form fields. Pure: given a field
 * and everything known about you, decide the value, where it came from, and
 * whether you must look at it.
 *
 *   resume file → learned mapping → profile rules → application answers →
 *   answer bank → (open question → AI draft) → needs you
 *
 * Legal attestations and consent boxes are never auto-answered.
 */
import type { AnswerValue, ApplyAnswers, FormField, PlannedAnswer, Profile } from '@/lib/types'

export interface ResolveContext {
  profile: Partial<Profile>
  answers: ApplyAnswers
  bank: { question_norm: string; answer: string; field_type: string }[]
  mappings: { field_sig: string; profile_key: string }[]
  atsType: string
  resumePdf: string | null
  resumeFileName: string
  coverLetterText?: string | null
}

export function normQuestion(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/\(required\)|\(optional\)/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const fieldSig = (f: FormField): string => `${normQuestion(f.label)}|${(f.name || '').toLowerCase()}`

/** Token-set similarity in [0,1] (order-insensitive, tolerant of extra words). */
export function tokenSetRatio(a: string, b: string): number {
  const A = new Set(normQuestion(a).split(' ').filter((w) => w.length > 1))
  const B = new Set(normQuestion(b).split(' ').filter((w) => w.length > 1))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return (2 * inter) / (A.size + B.size)
}

// ---------- profile rules (label → profile key) ----------

type Getter = (ctx: ResolveContext) => string

const first = (p: Partial<Profile>) => (p.full_name || '').trim().split(/\s+/)[0] || ''
const last = (p: Partial<Profile>) => {
  const parts = (p.full_name || '').trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

const INDIA_HINT =
  /\b(india|bengaluru|bangalore|hyderabad|secunderabad|chennai|mumbai|pune|delhi|new delhi|noida|gurgaon|gurugram|kolkata|ahmedabad|kochi|coimbatore|jaipur|chandigarh|indore|trivandrum|thiruvananthapuram|vizag|visakhapatnam|vijayawada|mysuru|mysore|nagpur|lucknow|bhubaneswar|telangana|karnataka|tamil nadu|maharashtra|kerala|andhra pradesh)\b/i
const COUNTRY_NAMES =
  /^(united states|usa|us|united kingdom|uk|canada|germany|singapore|australia|uae|united arab emirates|netherlands|ireland|france|japan|india)$/i

/** Your country from your location (or an Indian phone number); '' when unsure. */
export function countryOf(p: Partial<Profile>): string {
  const loc = (p.current_location || '').trim()
  if (INDIA_HINT.test(loc)) return 'India'
  const last = loc.split(',').map((x) => x.trim()).filter(Boolean).pop() || ''
  if (COUNTRY_NAMES.test(last)) return last
  if (/^\s*(\+91|0091)/.test(p.phone || '')) return 'India'
  return ''
}

/** "+91" from your phone number, or from your country. */
export function phoneCode(p: Partial<Profile>): string {
  const m = /^\s*\+(\d{1,3})(?=[\s-])/.exec(p.phone || '')
  if (m) return `+${m[1]}`
  if (/^\s*\+91\d{10}$/.test(p.phone || '')) return '+91'
  return countryOf(p) === 'India' ? '+91' : ''
}

/** [label regex, profile key, getter]. First match wins; a null getter = recognised, don't fill. */
export const PROFILE_RULES: [RegExp, string, Getter | null][] = [
  // Someone else's name: recognised so it isn't filled with yours.
  [/\b(father|mother|parent|spouse|guardian|reference|referr?er|recruiter|hiring manager|emergency contact)('?s)?\s+(full\s+)?name\b/, 'other_name', null],
  // "College name" / "Current company name" are your details, not a person's name.
  [/\b(college|university|school|institut\w*)\s+name\b|\bname of (your |the )?(college|university|school|institut\w*)\b/, 'college', (c) => c.profile.college || ''],
  [/\b(company|employer|organi[sz]ation)\s+name\b|\bname of (your )?(current )?(company|employer|organi[sz]ation)\b/, 'current_company', (c) => c.profile.current_company || ''],
  [/\bpreferred\s+(first\s+)?name\b/, 'first_name', (c) => first(c.profile)],
  [/\bfirst\s*name\b|\bgiven\s*name\b/, 'first_name', (c) => first(c.profile)],
  [/\blast\s*name\b|\bsurname\b|\bfamily\s*name\b/, 'last_name', (c) => last(c.profile)],
  [/\bfull\s*name\b|^name$|\byour name\b|\bcandidate name\b|^legal name/, 'full_name', (c) => c.profile.full_name || ''],
  // Labels are normalised (punctuation → spaces) before matching: "E-mail" arrives as "e mail".
  [/\be ?mail\b/, 'email', (c) => c.profile.email || ''],
  [/\b(country|dial(ling)?|phone|isd|calling)\s*code\b/, 'phone_code', (c) => phoneCode(c.profile)],
  [/\bphone\b|\bmobile\b|\bcontact (no|number)\b|\bwhats ?app\b/, 'phone', (c) => c.profile.phone || ''],
  [/\bcountry\b/, 'country', (c) => countryOf(c.profile)],
  [/\blinked ?in\b/, 'linkedin', (c) => c.profile.linkedin || ''],
  [/\bgit ?hub\b/, 'github', (c) => c.profile.github || ''],
  [/\bportfolio\b|\bpersonal (web)?site\b|\bwebsite\b|\bother (url|link)/, 'portfolio', (c) => c.profile.portfolio || c.profile.github || ''],
  [/\b(current )?(city|location)\b|\bwhere are you (currently )?(based|located)\b|\baddress\b/, 'current_location', (c) => c.profile.current_location || ''],
  [/\bcurrent (company|employer|organi[sz]ation)\b|\bmost recent (company|employer)\b/, 'current_company', (c) => c.profile.current_company || ''],
  [/\bcurrent (job )?(title|role|designation|position)\b/, 'current_role', (c) => c.profile.current_role || ''],
  [/\b(school|college|university|institution)\b/, 'college', (c) => c.profile.college || ''],
  [/\bdegree\b|\bqualification\b|\bfield of study\b|\bdiscipline\b|\bmajor\b/, 'degree', (c) => c.profile.degree || ''],
  [/\bgraduat\w*\s*(year|date)\b|\byear of (passing|graduation)\b|\bbatch\b/, 'graduation_year', (c) => c.profile.graduation_year || ''],
  [/\b(total |years of |relevant )?(work )?experience\b.*\byears?\b|\byears of experience\b|\bhow many years\b/, 'experience_years', (c) => (c.profile.experience_years || '').replace(/[^\d.]/g, '') || ''],
  [/\bdate of birth\b|\bdob\b/, 'date_of_birth', (c) => c.profile.date_of_birth || ''],
]

// ---------- application answers (Settings → Application answers) ----------

type AnswerKey = keyof ApplyAnswers

/** Never auto-answered, regardless of settings. */
export const ATTESTATION_RE =
  /\b(i certify|i hereby|i confirm|i acknowledge|i agree|i attest|i understand|i consent|consent to|privacy (policy|notice)|terms (and|&) conditions|terms of (use|service)|true and (complete|accurate)|accurate to the best)\b/

export const ANSWER_RULES: [RegExp, AnswerKey][] = [
  [/\b(require|need)\w*\b.*\bsponsor|\bsponsorship\b|\bvisa\b/, 'sponsorship_now'],
  [/\b(legally )?(authori[sz]ed|eligible|permitted|right) to work\b|\bwork (permit|authori[sz]ation)\b/, 'authorized_india'],
  [/\bcitizen(ship)?\b|\bnationality\b/, 'citizenship'],
  [/\bnotice period\b|\bhow (soon|quickly) (can|could|would|will) you (be available to )?(join|start)\b|\bwhen can you (join|start)\b|\bjoining (time|availability|date)\b|\bavailable to join\b/, 'notice_period'],
  [/\b(earliest |available )?start(ing)? date\b|\bwhen can you start\b|\bavailability\b|\bavailable to start\b/, 'start_date'],
  [/\bcurrent (ctc|salary|compensation|package|pay)\b/, 'current_ctc'],
  [/\bexpected (ctc|salary|compensation|package|pay)\b|\bsalary expectation|\bdesired (salary|compensation|pay)\b|\bcompensation expectation/, 'expected_ctc'],
  [/\brelocat/, 'relocation'],
  [/\b(remote|hybrid|on ?site|in office|work from office)\b/, 'work_modes'],
  [/\btravel\b/, 'travel'],
  [/\bpronoun/, 'pronouns'],
  [/\bgender\b|\bsex\b/, 'gender'],
  [/\brace\b|\bethnic/, 'race'],
  [/\bhispanic\b|\blatino\b/, 'race'],
  [/\bveteran\b|\bmilitary\b|\barmed forces\b/, 'veteran'],
  [/\bdisabilit/, 'disability'],
  [/\bhow did you (hear|find|learn)\b|\bsource\b|\breferred by\b|\bwhere did you (hear|find)\b/, 'hear_about'],
  [/\blanguages?\b.*\b(speak|know|fluent|proficien)|\bwhich languages\b/, 'languages'],
  [/\b(18|eighteen) (years|or older)|\bover 18\b|\blegal age\b/, 'over_18'],
  [/\bbackground (check|verification)\b|\bdrug (test|screen)/, 'background_check'],
]

const EEO_KEYS: AnswerKey[] = ['gender', 'race', 'veteran', 'disability', 'pronouns']

/** Profile fields that answer the same question as an Application answer. */
const PROFILE_FALLBACK: Partial<Record<AnswerKey, (p: Partial<Profile>) => string>> = {
  notice_period: (p) => p.notice_period || '',
  current_ctc: (p) => p.current_ctc || '',
  expected_ctc: (p) => p.expected_ctc || '',
  relocation: (p) => p.willing_to_relocate || '',
  gender: (p) => p.gender || '',
}

// ---------- option matching ----------

const YES = /^(yes|y|true|i am|i do|i will|i have|i can|authori[sz]ed|willing|open to)\b/i
const NO = /^(no|n|false|i am not|i do not|i don'?t|i will not|not)\b/i
const DECLINE = /(decline|prefer not|don'?t wish|do not wish|not to (say|answer|disclose)|choose not|rather not|not specified)/i

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#. ]+/g, ' ').replace(/\s+/g, ' ').trim()

const SYNONYMS: [RegExp, RegExp][] = [
  [/\b(b\.?\s?tech|b\.?\s?e|bachelor)/i, /bachelor/i],
  [/\b(m\.?\s?tech|m\.?\s?e|m\.?\s?s|master)/i, /master/i],
  [/\bph\.?\s?d|doctor/i, /doctor|ph\.?d/i],
  [/\bmale\b/i, /^(male|man)\b/i],
  [/\bfemale\b/i, /^(female|woman)\b/i],
  [/\bimmediate/i, /immediate|0 days|none|right away/i],
]

/** Pick the option that best matches a desired value, or null. */
export function matchOption(desired: string, options: string[]): string | null {
  const d = norm(desired)
  if (!d || !options.length) return null
  const clean = options.filter((o) => o && !/^(select|choose|--|please select)/i.test(o.trim()))
  // exact
  const exact = clean.find((o) => norm(o) === d)
  if (exact) return exact
  // yes / no / decline families
  if (YES.test(d)) return clean.find((o) => YES.test(norm(o))) ?? null
  if (NO.test(d)) return clean.find((o) => NO.test(norm(o))) ?? null
  if (DECLINE.test(d)) return clean.find((o) => DECLINE.test(o)) ?? null
  // synonyms (degree names, gender, immediate)
  for (const [want, opt] of SYNONYMS) {
    if (want.test(d)) {
      const hit = clean.find((o) => opt.test(o))
      if (hit) return hit
    }
  }
  // numeric buckets: "0-1 years", "1 to 3", "5+"
  const n = Number.parseFloat(d.replace(/[^\d.]/g, ''))
  if (Number.isFinite(n) && /\d/.test(d)) {
    for (const o of clean) {
      const r = /(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/.exec(o)
      if (r && n >= Number(r[1]) && n <= Number(r[2])) return o
      const plus = /(\d+(?:\.\d+)?)\s*\+/.exec(o)
      if (plus && n >= Number(plus[1])) return o
      const lt = /(less than|under|<)\s*(\d+(?:\.\d+)?)/i.exec(o)
      if (lt && n < Number(lt[2])) return o
    }
  }
  // containment either way, longest option first
  const contained = [...clean]
    .sort((a, b) => b.length - a.length)
    .find((o) => {
      const no = norm(o)
      return no.length > 2 && (d.includes(no) || no.includes(d))
    })
  return contained ?? null
}

// ---------- the chain ----------

const OPEN_QUESTION = /\bwhy\b|\btell us\b|\bdescribe\b|\bexplain\b|\bcover letter\b|\babout (yourself|you)\b|\bwhat (interests|excites|motivates)\b|\banything else\b|\badditional information\b|\bshare\b.*\b(project|example|experience)\b|\bhow would you\b/

function answerFor(key: AnswerKey, ctx: ResolveContext, field: FormField): string | null {
  const a = ctx.answers
  if (a.always_ask.includes(key)) return null
  // Settings → Application answers first, then the same detail from your Profile.
  const own = a[key]
  const v = (typeof own === 'string' && own.trim()) || PROFILE_FALLBACK[key]?.(ctx.profile) || own
  if (key === 'work_modes') {
    const modes = (a.work_modes || []).map((m) => m.toLowerCase())
    const label = field.label.toLowerCase()
    const asks = /remote/.test(label) ? 'remote' : /hybrid/.test(label) ? 'hybrid' : /on[- ]?site|office/.test(label) ? 'onsite' : null
    if (asks && (field.kind === 'radio' || field.kind === 'select' || field.kind === 'checkbox')) {
      return modes.some((m) => m.includes(asks)) ? 'Yes' : 'No'
    }
    return modes.length ? a.work_modes.join(', ') : null
  }
  if (key === 'sponsorship_now' && /\bfuture\b/i.test(field.label)) return a.sponsorship_future || null
  if (key === 'current_ctc' || key === 'expected_ctc') {
    const val = String(v || '')
    if (!val) return a.leave_salary_blank && !field.required ? '' : null
    if (field.kind === 'text' && field.input_type === 'number') return val.replace(/[^\d.]/g, '')
    return field.kind === 'textarea' ? `${val}${a.currency ? ` ${a.currency}` : ''} (${a.salary_text || 'negotiable'})` : val
  }
  if (EEO_KEYS.includes(key) && !v) return 'Decline to self-identify'
  return typeof v === 'string' && v ? v : null
}

/**
 * skipProfile: don't answer from Profile fields (used for questions about a
 * different degree/school than the one in your profile, and yes/no questions).
 */
export function resolveField(field: FormField, ctx: ResolveContext, opts: { skipProfile?: boolean } = {}): PlannedAnswer {
  const label = normQuestion(field.label)
  const base = { field_id: field.id, filled: false, profile_key: null as string | null }
  const done = (value: AnswerValue, source: PlannedAnswer['source'], confidence: PlannedAnswer['confidence'], note: string | null = null, profileKey: string | null = null): PlannedAnswer => ({
    ...base,
    value,
    source,
    confidence,
    needs_you: false,
    note,
    profile_key: profileKey,
  })
  const needYou = (note: string): PlannedAnswer => ({ ...base, value: null, source: 'none', confidence: 'none', needs_you: field.required, note })

  // Files: the locked resume; cover letters are optional unless required.
  if (field.kind === 'file') {
    if (/cover/.test(label)) return field.required ? needYou('Cover letter upload required — attach one in the browser window') : done(null, 'none', 'none', 'Optional cover letter skipped')
    if (ctx.resumePdf) return done(ctx.resumePdf, 'resume', 'high', ctx.resumeFileName)
    return needYou('No compiled resume to upload')
  }

  if (ATTESTATION_RE.test(label)) return { ...needYou('Legal statement — always needs your tick'), needs_you: true }

  const choice = field.kind === 'select' || field.kind === 'radio' || field.kind === 'combobox' || (field.kind === 'checkbox' && field.options.length > 1)
  const fit = (value: string, source: PlannedAnswer['source'], conf: PlannedAnswer['confidence'], note: string | null = null, key: string | null = null): PlannedAnswer => {
    if (field.kind === 'checkbox' && field.options.length <= 1) {
      const yes = YES.test(norm(value))
      return done(yes, source, conf, note, key)
    }
    if (!choice) {
      const v = field.max_length ? value.slice(0, field.max_length) : value
      return done(v, source, conf, note, key)
    }
    const opt = matchOption(value, field.options)
    if (opt) return done(field.kind === 'checkbox' ? [opt] : opt, source, opt.toLowerCase() === value.toLowerCase() ? conf : 'medium', note, key)
    if (field.kind === 'combobox') return done(value, source, 'medium', 'Typed into a search dropdown — check the selection', key)
    return needYou(`Saved answer “${value}” matches none of the options`)
  }

  // 1. learned mapping (your past corrections for this ATS)
  const sig = fieldSig(field)
  const mapped = ctx.mappings.find((m) => m.field_sig === sig)
  if (mapped) {
    const rule = PROFILE_RULES.find(([, k]) => k === mapped.profile_key)
    const v = rule?.[2]?.(ctx) ?? (ctx.profile as Record<string, string>)[mapped.profile_key] ?? ''
    if (v) return fit(v, 'mapping', 'high', null, mapped.profile_key)
  }

  // 2. application answers (checked before generic profile rules so "current CTC" isn't a company name)
  for (const [re, key] of ANSWER_RULES) {
    if (!re.test(label)) continue
    const v = answerFor(key, ctx, field)
    if (v === null) return needYou(ctx.answers.always_ask.includes(key) ? 'You chose “Always ask me” for this' : `Set “${key.replace(/_/g, ' ')}” in Settings → Application answers`)
    if (v === '') return done('', 'answers', 'high', 'Left blank (optional salary)')
    return fit(v, 'answers', 'high', null, key)
  }

  // 3. profile rules
  for (const [re, key, get] of opts.skipProfile ? [] : PROFILE_RULES) {
    if (!re.test(label)) continue
    if (!get) break // recognised as "someone else's name" etc.: don't fill from profile
    const v = get(ctx)
    if (v) return fit(v, 'profile', 'high', null, key)
    return needYou(`Your Profile has no ${key.replace(/_/g, ' ')}`)
  }

  // 4. answer bank (exact, then fuzzy)
  const exact = ctx.bank.find((b) => b.question_norm === label)
  if (exact) return fit(exact.answer, 'answer_bank', 'high')
  let best: (typeof ctx.bank)[number] | null = null
  let bestScore = 0
  for (const b of ctx.bank) {
    const s = tokenSetRatio(label, b.question_norm)
    if (s > bestScore) {
      best = b
      bestScore = s
    }
  }
  if (best && bestScore >= 0.9) return fit(best.answer, 'answer_bank', 'medium', 'Similar to a question you answered before')

  // 5. open questions → AI draft later (always reviewed)
  if ((field.kind === 'textarea' || (field.kind === 'text' && (field.max_length ?? 0) > 200)) && OPEN_QUESTION.test(label)) {
    return { ...base, value: null, source: 'generated', confidence: 'review', needs_you: false, note: 'pending-generation' }
  }

  // 6. unknown
  if (!field.required) return done(null, 'none', 'none', 'Optional — left blank')
  return needYou('Not sure how to answer this')
}

/** True when nothing blocks submission. */
export function planReady(answers: Record<string, PlannedAnswer>): boolean {
  return !Object.values(answers).some((a) => a.needs_you)
}
