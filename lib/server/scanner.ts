/**
 * Career-page scanner: fetch a company's job listings and match them against
 * the user's profile.
 *
 * Known ATS boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
 * Recruitee) are read through their public JSON APIs — reliable and fast.
 * Anything else falls back to scraping anchor tags from the page HTML, which
 * won't work for boards that render jobs purely with JavaScript; those get a
 * clear status message instead of silently showing zero jobs.
 */
import { parse as parseHtml } from 'node-html-parser'

import type { Company, ScanResult, Settings } from '@/lib/types'

import * as db from './db'
import type { ScannedJob } from './db'
import { buildKeywords, matchTitle, profileYears } from './matching'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT_MS = 25_000
const MAX_JOBS_PER_COMPANY = 400

export { buildKeywords, matchTitle, profileYears } from './matching'

export class ScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanError'
  }
}

const nowIso = () => new Date().toISOString()

async function get(url: string): Promise<Response> {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return r
}

const getJson = async (url: string): Promise<unknown> => (await get(url)).json()

function firstPathSeg(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return parts[0] ?? null
  } catch {
    return null
  }
}

interface RawJob {
  title: string
  url: string
  location: string | null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const prop = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined

// ---------- known ATS boards ----------

async function scanGreenhouse(url: string): Promise<RawJob[]> {
  const token = firstPathSeg(url)
  if (!token) throw new ScanError("Couldn't read the board name from the Greenhouse URL.")
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`)
  return asArray(prop(data, 'jobs')).map((j) => ({
    title: str(prop(j, 'title')),
    url: str(prop(j, 'absolute_url')),
    location: str(prop(prop(j, 'location'), 'name')) || null,
  }))
}

async function scanLever(url: string): Promise<RawJob[]> {
  const token = firstPathSeg(url)
  if (!token) throw new ScanError("Couldn't read the company name from the Lever URL.")
  const data = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`)
  return asArray(data).map((j) => ({
    title: str(prop(j, 'text')),
    url: str(prop(j, 'hostedUrl')),
    location: str(prop(prop(j, 'categories'), 'location')) || null,
  }))
}

async function scanAshby(url: string): Promise<RawJob[]> {
  const token = firstPathSeg(url)
  if (!token) throw new ScanError("Couldn't read the org name from the Ashby URL.")
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`)
  return asArray(prop(data, 'jobs')).map((j) => ({
    title: str(prop(j, 'title')),
    url: str(prop(j, 'jobUrl')) || str(prop(j, 'applyUrl')),
    location: str(prop(j, 'location')) || null,
  }))
}

async function scanWorkable(url: string): Promise<RawJob[]> {
  const token = firstPathSeg(url)
  if (!token) throw new ScanError("Couldn't read the account name from the Workable URL.")
  const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${token}`)
  return asArray(prop(data, 'jobs')).map((j) => {
    const loc = [str(prop(j, 'city')), str(prop(j, 'country'))].filter(Boolean).join(', ')
    return {
      title: str(prop(j, 'title')),
      url: str(prop(j, 'url')) || str(prop(j, 'application_url')),
      location: loc || null,
    }
  })
}

async function scanSmartRecruiters(url: string): Promise<RawJob[]> {
  const token = firstPathSeg(url)
  if (!token) {
    throw new ScanError("Couldn't read the company name from the SmartRecruiters URL.")
  }
  const data = await getJson(
    `https://api.smartrecruiters.com/v1/companies/${token}/postings`,
  )
  return asArray(prop(data, 'content')).map((j) => {
    const loc = prop(j, 'location')
    const locS = [str(prop(loc, 'city')), str(prop(loc, 'country'))].filter(Boolean).join(', ')
    return {
      title: str(prop(j, 'name')),
      url: `https://jobs.smartrecruiters.com/${token}/${String(prop(j, 'id'))}`,
      location: locS || null,
    }
  })
}

async function scanRecruitee(url: string): Promise<RawJob[]> {
  const host = new URL(url).host
  const data = await getJson(`https://${host}/api/offers/`)
  return asArray(prop(data, 'offers')).map((j) => ({
    title: str(prop(j, 'title')),
    url: str(prop(j, 'careers_url')),
    location: str(prop(j, 'location')) || null,
  }))
}

// ---------- generic HTML fallback ----------

const JOB_PATH_RE =
  /\/(job|jobs|career|careers|position|positions|opening|openings|vacanc|opportunit|role|roles)(\/|-|\b)|gh_jid=|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com/i
const TITLE_WORD_RE =
  /\b(engineer|developer|scientist|analyst|manager|designer|architect|consultant|intern|devops|sre|administrator|specialist|executive|associate|programmer|tester|qa|recruiter|accountant|marketer)\b/i
const GENERIC_TEXT = new Set([
  'apply', 'apply now', 'learn more', 'view job', 'view jobs', 'view all',
  'see all', 'see all jobs', 'careers', 'career', 'jobs', 'read more',
  'details', 'more', 'view details', 'know more', 'open positions',
  'all jobs', 'join us', 'view opening', 'explore',
])

async function scanHtmlPage(url: string): Promise<RawJob[]> {
  const resp = await get(url)
  const contentType = resp.headers.get('content-type') || 'text/html'
  if (!contentType.includes('text/html')) {
    throw new ScanError("URL didn't return an HTML page.")
  }
  const root = parseHtml(await resp.text())
  const jobs: RawJob[] = []
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href')
    if (!href || /^(mailto:|javascript:|tel:|#)/i.test(href)) continue
    const textClean = a.textContent.replace(/\s+/g, ' ').trim()
    if (textClean.length < 4 || textClean.length > 90) continue
    if (GENERIC_TEXT.has(textClean.toLowerCase())) continue
    let hrefAbs: string
    try {
      hrefAbs = new URL(href, url).toString()
    } catch {
      continue
    }
    const looksLikeJob = JOB_PATH_RE.test(hrefAbs) || TITLE_WORD_RE.test(textClean)
    if (!looksLikeJob) continue
    // Nav links back to the listing page itself aren't postings.
    if (hrefAbs.replace(/\/+$/, '') === url.replace(/\/+$/, '')) continue
    jobs.push({ title: textClean, url: hrefAbs, location: null })
  }
  return jobs
}

function extractJobs(url: string): Promise<RawJob[]> {
  let host = ''
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    throw new ScanError('That career page URL is not valid.')
  }
  if (host.includes('greenhouse.io')) return scanGreenhouse(url)
  if (host.includes('lever.co')) return scanLever(url)
  if (host.includes('ashbyhq.com')) return scanAshby(url)
  if (host.includes('workable.com')) return scanWorkable(url)
  if (host.includes('smartrecruiters.com')) return scanSmartRecruiters(url)
  if (host.includes('recruitee.com')) return scanRecruitee(url)
  return scanHtmlPage(url)
}

/** Canonical form for dedupe: drop fragments and tracking params. */
function normUrl(u: string): string | null {
  if (!u) return null
  let parts: URL
  try {
    parts = new URL(u)
  } catch {
    return null
  }
  if (parts.protocol !== 'http:' && parts.protocol !== 'https:') return null
  const params = new URLSearchParams()
  for (const [k, v] of parts.searchParams) {
    if (k.toLowerCase().startsWith('utm_') || k.toLowerCase() === 'ref') continue
    params.append(k, v)
  }
  const query = params.toString()
  const pathname = parts.pathname.replace(/\/+$/, '')
  return `${parts.protocol}//${parts.host}${pathname}${query ? `?${query}` : ''}`
}

// ---------- orchestration ----------

const inProgress = new Set<number>()

/**
 * Fetch a company's career page, match jobs, sync to the DB. Always records the
 * outcome on the company row, even on failure.
 */
export async function scanCompany(
  company: Company,
  settings: Settings,
): Promise<ScanResult> {
  const cid = company.id
  if (inProgress.has(cid)) {
    throw new ScanError('A scan for this company is already running.')
  }
  inProgress.add(cid)
  try {
    return await scanCompanyInner(company, settings)
  } finally {
    inProgress.delete(cid)
  }
}

async function scanCompanyInner(
  company: Company,
  settings: Settings,
): Promise<ScanResult> {
  const profile = settings.profile || {}
  const cfg = settings.companies || {}
  const keywords = buildKeywords(profile, cfg.match_keywords || '')
  const years = profileYears(profile)

  let rawJobs: RawJob[]
  try {
    rawJobs = await extractJobs(company.career_url)
  } catch (e) {
    // ScanError carries a user-facing message already; anything else (network
    // failure, bad JSON from an ATS API) gets wrapped into one.
    const err =
      e instanceof ScanError
        ? e
        : new ScanError(
            e instanceof SyntaxError
              ? `Unexpected response from the job board: ${e.message}`
              : `Couldn't reach the page: ${(e as Error).message}`,
          )
    await db.updateCompany(company.id, {
      last_scanned_at: nowIso(),
      last_status: 'error',
      last_error: err.message.slice(0, 300),
    })
    throw err
  }

  const seen = new Set<string>()
  const clean: ScannedJob[] = []
  for (const j of rawJobs) {
    const url = normUrl(j.url)
    const title = (j.title || '').replace(/\s+/g, ' ').trim()
    if (!url || !title || seen.has(url)) continue
    seen.add(url)
    const [matched, reason] = matchTitle(title, keywords, years)
    clean.push({
      title: title.slice(0, 200),
      url,
      location: j.location || null,
      matched,
      match_reason: reason,
    })
    if (clean.length >= MAX_JOBS_PER_COMPANY) break
  }

  const result = await db.syncCompanyJobs(company.id, clean)
  let status = 'ok'
  let error: string | null = null
  if (!clean.length) {
    status = 'empty'
    error =
      'No job links found — the page may load jobs with JavaScript. ' +
      'If the company uses Greenhouse/Lever/Workable etc., paste that board URL instead.'
  }
  await db.updateCompany(company.id, {
    last_scanned_at: nowIso(),
    last_status: status,
    last_error: error,
    jobs_found: clean.length,
  })
  console.log(
    `[autoapply.scanner] Scanned ${company.name}: ${result.found} found, ` +
      `${result.new} new, ${result.matched} matched`,
  )
  return { ...result, keywords_used: keywords.size }
}
