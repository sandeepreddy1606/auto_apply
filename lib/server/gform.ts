/**
 * Google Form automation without any AI.
 *
 * Google Forms embed their full question schema in the public viewform HTML as a
 * JS variable `FB_PUBLIC_LOAD_DATA_`. We parse that JSON, map each question to a
 * profile field via keyword heuristics, and POST the answers to /formResponse —
 * the same request the browser makes.
 *
 * Limitations (surfaced to the UI instead of failing silently):
 * - Forms that require Google sign-in cannot be submitted programmatically.
 * - File-upload questions (resume upload) require sign-in; we flag them.
 * - Grid questions are unsupported and flagged.
 */
import type {
  FormAnswers,
  GoogleForm,
  GoogleFormField,
  MissingQuestion,
  Profile,
} from '@/lib/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// A minimal UA makes Google return 401 to some public forms as if we were a bot;
// a full browser-like header set gets the same 200 a real Chrome would. Forms
// that genuinely require sign-in still redirect to accounts.google.com (handled).
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

const TIMEOUT_MS = 30_000

const TYPE_NAMES: Record<number, string> = {
  0: 'short_answer',
  1: 'paragraph',
  2: 'multiple_choice',
  3: 'dropdown',
  4: 'checkboxes',
  5: 'linear_scale',
  7: 'grid',
  9: 'date',
  10: 'time',
  13: 'file_upload',
}

/**
 * Ordered: first matching rule wins. Patterns are regexes tested on the
 * lowercased question title. A null key is an explicit "recognised but don't
 * fill" rule (e.g. "company name" must not receive your own name).
 */
export const FIELD_RULES: [RegExp, keyof Profile | 'first_name' | 'last_name' | null][] = [
  [/first\s*name/, 'first_name'],
  [/last\s*name|surname/, 'last_name'],
  [/(company|college|institute|university|father|mother|referr?er).{0,12}name/, null],
  [/full\s*name|candidate\s*name|your\s*name|^name\b|\bname\s*[:?]?$/, 'full_name'],
  [/e-?mail|mail\s*id/, 'email'],
  [/phone|mobile|contact\s*(no|num)|whats\s*app/, 'phone'],
  [/resume|\bcv\b|curriculum/, 'resume_url'],
  [/linked\s*in/, 'linkedin'],
  [/git\s*hub/, 'github'],
  [/portfolio|personal\s*website/, 'portfolio'],
  [/notice\s*period|how\s*soon.*join|joining/, 'notice_period'],
  [/(total|overall|relevant|years?\s*of)\s*.*experience|experience|\byoe\b|\bexp\b/, 'experience_years'],
  [/current\s*(ctc|salary|compensation|package)/, 'current_ctc'],
  [/expected\s*(ctc|salary|compensation|package)|salary\s*expectation/, 'expected_ctc'],
  [/\bctc\b|salary|compensation|package|stipend/, 'expected_ctc'],
  [/current\s*(company|organi[sz]ation|employer)|company|organi[sz]ation|employer/, 'current_company'],
  [/designation|current\s*(role|position)|job\s*title/, 'current_role'],
  [/preferred\s*location/, 'preferred_location'],
  [/location|city|based\s*(in|out)/, 'current_location'],
  [/relocat/, 'willing_to_relocate'],
  [/gender|\bsex\b/, 'gender'],
  [/college|university|institute|school/, 'college'],
  [/degree|qualification|education/, 'degree'],
  [/graduat|passing\s*year|pass\s*out|batch|year\s*of\s*(pass|complet)/, 'graduation_year'],
  [/skill|tech\s*stack|technolog/, 'skills'],
  [/date\s*of\s*birth|\bdob\b/, 'date_of_birth'],
  [/why|cover\s*letter|about\s*(yourself|you)|tell\s*us|describe|motivation|anything\s*else/, 'cover_note'],
]

export class GFormError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GFormError'
  }
}

/** The FB_PUBLIC_LOAD_DATA_ blob is a deeply nested, untyped array. */
type LoadData = unknown[]

function extractLoadData(html: string): LoadData {
  const m = /FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);\s*<\/script>/.exec(html)
  if (!m) {
    throw new GFormError(
      'Could not find form data in the page (form may be closed or require sign-in).',
    )
  }
  return JSON.parse(m[1]) as LoadData
}

const at = (arr: unknown, i: number): unknown =>
  Array.isArray(arr) ? arr[i] : undefined

/** Fetch and parse a Google Form's public schema. */
export async function fetchForm(url: string): Promise<GoogleForm> {
  let resp: Response
  try {
    resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new GFormError(`Could not fetch form: ${(e as Error).message}`)
  }

  const finalUrl = resp.url || url
  if (finalUrl.includes('accounts.google.com')) {
    throw new GFormError(
      "This form requires Google sign-in, so it can't be auto-filled. Open it and apply manually.",
    )
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new GFormError(
      "This form is restricted (Google sign-in / organization-only), so it can't be auto-filled. " +
        'Open it and apply manually.',
    )
  }
  if (resp.status !== 200) {
    throw new GFormError(`Form page returned HTTP ${resp.status}.`)
  }

  const html = await resp.text()
  if (html.includes('no longer accepting responses')) {
    throw new GFormError('This form is no longer accepting responses.')
  }

  const data = extractLoadData(html)

  const formBlock = at(data, 1)
  if (!Array.isArray(formBlock)) {
    throw new GFormError('Unexpected form data layout: missing form block.')
  }
  const items = (at(formBlock, 1) as unknown[]) || []
  const description = (at(formBlock, 0) as string) || ''
  const title =
    (formBlock.length > 8 && (at(formBlock, 8) as string)) ||
    (at(data, 3) as string) ||
    'Google Form'

  const fields: GoogleFormField[] = []
  let pageCount = 1
  for (const item of items) {
    if (!Array.isArray(item)) continue
    const itemId = item[0] as number
    const qTitle = item[1] as string | null
    const qDesc = item[2] as string | null
    const qType = item[3] as number
    if (qType === 8) {
      // section break => new page
      pageCount += 1
      continue
    }
    const entries = (item.length > 4 ? item[4] : null) as unknown[] | null
    if (!entries || !entries.length) continue // text/image/video blocks
    for (const entry of entries) {
      if (!Array.isArray(entry)) continue
      const entryId = entry[0] as number
      const optionsRaw = entry[1] as unknown[] | null
      const required = entry.length > 2 ? Boolean(entry[2]) : false
      if (entryId == null) continue
      const options: string[] = []
      for (const opt of optionsRaw || []) {
        if (Array.isArray(opt) && typeof opt[0] === 'string') options.push(opt[0])
      }
      fields.push({
        item_id: itemId,
        entry_id: entryId,
        title: (qTitle || '').trim(),
        description: qDesc ? qDesc.trim() : '',
        type_code: qType,
        type: TYPE_NAMES[qType] ?? `type_${qType}`,
        required,
        options,
        supported: [0, 1, 2, 3, 4, 5, 9].includes(qType),
      })
    }
  }

  const fbzxMatch = /name="fbzx"\s+value="([^"]+)"/.exec(html)
  const collectsEmail = html.includes('name="emailAddress"')

  const base = finalUrl.split('?')[0]
  let submitUrl = base.replace(/\/viewform.*$/, '/formResponse')
  if (!submitUrl.endsWith('/formResponse')) {
    submitUrl = `${base.replace(/\/+$/, '')}/formResponse`
  }

  return {
    title,
    description,
    url: finalUrl,
    submit_url: submitUrl,
    fbzx: fbzxMatch ? fbzxMatch[1] : null,
    collects_email: collectsEmail,
    page_count: pageCount,
    fields,
  }
}

function matchOption(options: string[], value: string): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  for (const opt of options) {
    if (opt.trim().toLowerCase() === v) return opt
  }
  for (const opt of options) {
    const o = opt.trim().toLowerCase()
    if (v.includes(o) || o.includes(v)) return opt
  }
  return null
}

function profileValue(profile: Partial<Profile>, key: string): string {
  if (key === 'first_name') return (profile.full_name || '').split(' ')[0]
  if (key === 'last_name') {
    const parts = (profile.full_name || '').split(' ')
    return parts.length > 1 ? parts[parts.length - 1] : ''
  }
  const v = profile[key as keyof Profile]
  return v == null ? '' : String(v)
}

export function mapFieldToProfile(title: string): string | null {
  const low = (title || '').toLowerCase()
  for (const [pattern, key] of FIELD_RULES) {
    if (pattern.test(low)) return key // may be null (explicit "don't map" rule)
  }
  return null
}

/** Heuristically prefill answers. Returns {entry_key: value}. */
export function suggestAnswers(form: GoogleForm, profile: Partial<Profile>): FormAnswers {
  const answers: FormAnswers = {}
  if (form.collects_email) {
    answers.emailAddress = profile.email || ''
  }

  for (const f of form.fields) {
    const key = `entry.${f.entry_id}`
    const mapped = mapFieldToProfile(f.title)
    if (!mapped) continue
    const value = profileValue(profile, mapped)
    if (!value) continue

    if (f.type_code === 0 || f.type_code === 1) {
      answers[key] = value
    } else if (f.type_code === 2 || f.type_code === 3) {
      const match = matchOption(f.options, value)
      if (match) answers[key] = match
    } else if (f.type_code === 4) {
      const picked: string[] = []
      for (const part of value.split(/[,/;]| and /)) {
        const match = matchOption(f.options, part.trim())
        if (match && !picked.includes(match)) picked.push(match)
      }
      if (picked.length) answers[key] = picked
    } else if (f.type_code === 5) {
      const match = matchOption(f.options.map(String), value)
      if (match) answers[key] = match
    } else if (f.type_code === 9 && mapped === 'date_of_birth') {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value)
      if (m) answers[key] = { year: m[1], month: m[2], day: m[3] }
    }
  }
  return answers
}

const isEmptyAnswer = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

export function unansweredRequired(
  form: GoogleForm,
  answers: FormAnswers,
): MissingQuestion[] {
  const missing: MissingQuestion[] = []
  for (const f of form.fields) {
    if (!f.required) continue
    if (isEmptyAnswer(answers[`entry.${f.entry_id}`])) {
      missing.push({ title: f.title, type: f.type, supported: f.supported })
    }
  }
  return missing
}

/** POST answers to the form. Throws GFormError on failure. */
export async function submitForm(form: GoogleForm, answers: FormAnswers): Promise<void> {
  const payload = new URLSearchParams()
  const fieldByKey = new Map(form.fields.map((f) => [`entry.${f.entry_id}`, f]))

  for (const [key, value] of Object.entries(answers)) {
    if (isEmptyAnswer(value)) continue
    if (key === 'emailAddress') {
      payload.append('emailAddress', String(value))
      continue
    }
    const field = fieldByKey.get(key)
    if (field && field.type_code === 9 && value && typeof value === 'object' && !Array.isArray(value)) {
      payload.append(`${key}_year`, String(value.year ?? ''))
      payload.append(`${key}_month`, String(value.month ?? ''))
      payload.append(`${key}_day`, String(value.day ?? ''))
    } else if (Array.isArray(value)) {
      for (const v of value) payload.append(key, String(v))
    } else {
      payload.append(key, String(value))
    }
  }

  const pages = form.page_count || 1
  payload.append('pageHistory', Array.from({ length: pages }, (_, i) => i).join(','))
  payload.append('fvv', '1')
  payload.append('draftResponse', '[]')
  if (form.fbzx) {
    payload.append('fbzx', form.fbzx)
    payload.append('partialResponse', JSON.stringify([null, null, form.fbzx]))
  }

  let resp: Response
  try {
    resp = await fetch(form.submit_url, {
      method: 'POST',
      body: payload,
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: form.url,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new GFormError(`Form submission request failed: ${(e as Error).message}`)
  }

  if (resp.status !== 200) {
    throw new GFormError(`Form submission returned HTTP ${resp.status}.`)
  }
  // A successful submit shows the confirmation page; a validation failure
  // re-renders the form itself (which contains FB_PUBLIC_LOAD_DATA_).
  if ((await resp.text()).includes('FB_PUBLIC_LOAD_DATA_')) {
    throw new GFormError(
      'Google rejected the submission (missing/invalid required answers). Review the answers and retry.',
    )
  }
}
