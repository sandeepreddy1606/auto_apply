/**
 * Career-page scanner: fetch a company's job listings (with descriptions where
 * the board's API includes them), score every job against your preferences,
 * and sync to the DB.
 *
 * Known ATS boards are read through their public JSON APIs: Greenhouse, Lever,
 * Ashby, Workable, SmartRecruiters, Recruitee and Workday. Big employers with
 * their own sites (Amazon, Microsoft/Eightfold, Google) are *searched* with
 * your target roles and locations (lib/jobs/bigtech.ts). A custom careers
 * page is checked for an embedded board first, then falls back to job
 * postings in the HTML (rendered in a headless browser when the page builds
 * its list with JavaScript). Boards whose list API has no descriptions get a
 * `jobs.fetch_jd` task per job, which the worker runs at a polite pace.
 */
import { parse as parseHtml } from 'node-html-parser'

import { detectAts, parseWorkday } from '@/lib/jobs/ats'
import type { SearchPlan } from '@/lib/jobs/bigtech'
import { detectBigTech, planSearch, searchAmazon, searchEightfold, searchGoogle } from '@/lib/jobs/bigtech'
import { buildScoreContext } from '@/lib/jobs/context'
import { HttpStatusError, asArray, getJson, getText, postJson, prop, relativePostedToIso, str, toIso } from '@/lib/jobs/fetch'
import { htmlToText, sanitizeHtml } from '@/lib/jobs/html'
import { scoreJob } from '@/lib/jobs/score'
import type { Company, ScanResult, Settings } from '@/lib/types'

import * as db from './db'
import type { ScannedJob } from './db'

const MAX_JOBS_PER_COMPANY = 400

export { buildKeywords, matchTitle, profileYears } from './matching'

export class ScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanError'
  }
}

const nowIso = () => new Date().toISOString()


export interface RawJob {
  title: string
  url: string
  location: string | null
  description_html?: string | null
  posted_at?: string | null
  ats_job_id?: string | null
  apply_url?: string | null
}

// ---------- known ATS boards ----------

async function scanGreenhouse(token: string): Promise<RawJob[]> {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`)
  return asArray(prop(data, 'jobs')).map((j) => ({
    title: str(prop(j, 'title')),
    url: str(prop(j, 'absolute_url')),
    location: str(prop(prop(j, 'location'), 'name')) || null,
    description_html: str(prop(j, 'content')) || null,
    posted_at: toIso(prop(j, 'first_published') ?? prop(j, 'updated_at')),
    ats_job_id: String(prop(j, 'id') ?? '') || null,
  }))
}

async function scanLever(token: string): Promise<RawJob[]> {
  const data = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`)
  return asArray(data).map((j) => {
    const lists = asArray(prop(j, 'lists'))
      .map((l) => `<h3>${str(prop(l, 'text'))}</h3><ul>${str(prop(l, 'content'))}</ul>`)
      .join('')
    return {
      title: str(prop(j, 'text')),
      url: str(prop(j, 'hostedUrl')),
      location: str(prop(prop(j, 'categories'), 'location')) || null,
      description_html: `${str(prop(j, 'description'))}${lists}${str(prop(j, 'additional'))}` || null,
      posted_at: toIso(prop(j, 'createdAt')),
      ats_job_id: str(prop(j, 'id')) || null,
      apply_url: str(prop(j, 'applyUrl')) || null,
    }
  })
}

async function scanAshby(token: string): Promise<RawJob[]> {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`)
  return asArray(prop(data, 'jobs')).map((j) => ({
    title: str(prop(j, 'title')),
    url: str(prop(j, 'jobUrl')) || str(prop(j, 'applyUrl')),
    location: str(prop(j, 'location')) || null,
    description_html: str(prop(j, 'descriptionHtml')) || null,
    posted_at: toIso(prop(j, 'publishedAt')),
    ats_job_id: str(prop(j, 'id')) || null,
    apply_url: str(prop(j, 'applyUrl')) || null,
  }))
}

async function scanWorkable(token: string): Promise<RawJob[]> {
  const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`)
  return asArray(prop(data, 'jobs')).map((j) => {
    const loc = [str(prop(j, 'city')), str(prop(j, 'country'))].filter(Boolean).join(', ')
    return {
      title: str(prop(j, 'title')),
      url: str(prop(j, 'url')) || str(prop(j, 'application_url')),
      location: loc || null,
      description_html: str(prop(j, 'description')) || null,
      posted_at: toIso(prop(j, 'published_on') ?? prop(j, 'created_at')),
      ats_job_id: str(prop(j, 'shortcode')) || null,
      apply_url: str(prop(j, 'application_url')) || null,
    }
  })
}

async function scanSmartRecruiters(token: string): Promise<RawJob[]> {
  const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`)
  return asArray(prop(data, 'content')).map((j) => {
    const loc = prop(j, 'location')
    const locS = [str(prop(loc, 'city')), str(prop(loc, 'country'))].filter(Boolean).join(', ')
    const id = String(prop(j, 'id'))
    return {
      title: str(prop(j, 'name')),
      url: `https://jobs.smartrecruiters.com/${token}/${id}`,
      location: locS || null,
      posted_at: toIso(prop(j, 'releasedDate')),
      ats_job_id: id,
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
    description_html: `${str(prop(j, 'description'))}${str(prop(j, 'requirements'))}` || null,
    posted_at: toIso(prop(j, 'published_at') ?? prop(j, 'created_at')),
    ats_job_id: String(prop(j, 'id') ?? '') || null,
  }))
}

/** Workday's public CXS API: POST …/wday/cxs/{tenant}/{site}/jobs, 20 per page. */
export async function scanWorkday(url: string): Promise<RawJob[]> {
  const wd = parseWorkday(url)
  if (!wd) throw new ScanError("Couldn't read the tenant/site from the Workday URL.")
  const api = `https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}/jobs`
  const out: RawJob[] = []
  for (let offset = 0; offset < MAX_JOBS_PER_COMPANY; offset += 20) {
    const data = await postJson(api, { appliedFacets: {}, limit: 20, offset, searchText: '' })
    const posts = asArray(prop(data, 'jobPostings'))
    for (const p of posts) {
      const path = str(prop(p, 'externalPath'))
      if (!path) continue
      out.push({
        title: str(prop(p, 'title')),
        url: `https://${wd.host}/${wd.site}${path}`,
        location: str(prop(p, 'locationsText')) || null,
        posted_at: relativePostedToIso(str(prop(p, 'postedOn'))),
        ats_job_id: path,
      })
    }
    const total = Number(prop(data, 'total') ?? 0)
    if (posts.length < 20 || offset + 20 >= total) break
  }
  return out
}

// ---------- generic HTML fallback ----------

/** A link that points at one specific posting, not a section of the careers site. */
const POSTING_PATH_RE =
  /\/(job|jobs|position|positions|opening|openings|vacancy|vacancies|requisition|req|posting|job-detail|jobdetail)s?\/[^?#]*?(\d{3,}|[a-z0-9]+(?:-[a-z0-9]+){2,})|[?&](gh_jid|jobid|job_id|jobId|reqid|req_id|requisitionid|pid)=|(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|myworkdayjobs\.com)\/[^/]+\/.+/i
const TITLE_WORD_RE =
  /\b(engineer|engineering|developer|scientist|analyst|designer|architect|consultant|intern|internship|devops|sre|administrator|specialist|programmer|tester|qa|sdet|sde|swe|technician|researcher|lead|manager|associate|executive|recruiter|accountant|trainee)\b/i
/** Section names on careers sites ("Military careers", "Job Categories", "Life at X"). */
const NAV_TEXT_RE =
  /\b(careers?|programs?|categor(?:y|ies)|teams?|benefits|culture|life at|students?|university|graduates?|military|veterans?|diversity|inclusion|locations?|faq|events?|blog|news|stories|search|sign ?in|log ?in|privacy|cookies?|about|overview|how we hire|hiring process|our people|departments?|talent community|join our)\b/i
const GENERIC_TEXT = new Set([
  'apply', 'apply now', 'learn more', 'view job', 'view jobs', 'view all',
  'see all', 'see all jobs', 'careers', 'career', 'jobs', 'read more',
  'details', 'more', 'view details', 'know more', 'open positions',
  'all jobs', 'join us', 'view opening', 'explore',
])

/**
 * Job postings linked from a careers page. Strict on purpose: a link needs a
 * job-title word in its text, or a URL that points at a single posting.
 * Section links like "Military careers" or "Job Categories" are skipped.
 */
export function extractJobLinks(html: string, url: string): RawJob[] {
  const root = parseHtml(html)
  const jobs: RawJob[] = []
  const listing = url.replace(/[?#].*$/, '').replace(/\/+$/, '')
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href')
    if (!href || /^(mailto:|javascript:|tel:|#)/i.test(href)) continue
    const textClean = a.textContent.replace(/\s+/g, ' ').trim()
    if (textClean.length < 4 || textClean.length > 120) continue
    if (GENERIC_TEXT.has(textClean.toLowerCase())) continue
    let hrefAbs: string
    try {
      hrefAbs = new URL(href, url).toString()
    } catch {
      continue
    }
    if (hrefAbs.replace(/[?#].*$/, '').replace(/\/+$/, '') === listing) continue
    const titleLike = TITLE_WORD_RE.test(textClean)
    const postingLink = POSTING_PATH_RE.test(hrefAbs)
    if (!titleLike && !postingLink) continue
    // Section/nav links are rejected unless the text reads like a role.
    if (!titleLike && NAV_TEXT_RE.test(textClean)) continue
    if (!postingLink && NAV_TEXT_RE.test(textClean) && textClean.split(' ').length <= 3) continue
    jobs.push({ title: textClean, url: hrefAbs, location: null })
  }
  return jobs
}

/** Job postings embedded as schema.org JobPosting JSON-LD on a listing page. */
export function extractJsonLdListings(html: string, url: string): RawJob[] {
  const out: RawJob[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    let data: unknown
    try {
      data = JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' '))
    } catch {
      continue
    }
    const stack: unknown[] = [data]
    while (stack.length) {
      const o = stack.pop()
      if (Array.isArray(o)) {
        stack.push(...o)
        continue
      }
      if (!o || typeof o !== 'object') continue
      const r = o as Record<string, unknown>
      if (r['@type'] === 'JobPosting' && typeof r.title === 'string' && typeof r.url === 'string') {
        const loc = Array.isArray(r.jobLocation) ? r.jobLocation[0] : r.jobLocation
        const addr = (loc as Record<string, unknown> | undefined)?.address as Record<string, string> | undefined
        let link: string
        try {
          link = new URL(r.url, url).toString()
        } catch {
          continue
        }
        out.push({
          title: r.title,
          url: link,
          location: addr ? [addr.addressLocality, addr.addressCountry].filter(Boolean).join(', ') || null : null,
          description_html: typeof r.description === 'string' ? r.description : null,
          posted_at: toIso(r.datePosted),
        })
      }
      for (const k of ['@graph', 'itemListElement', 'item']) if (r[k]) stack.push(r[k])
    }
  }
  return out
}

function genericJobs(html: string, url: string): RawJob[] {
  const ld = extractJsonLdListings(html, url)
  return ld.length ? ld : extractJobLinks(html, url)
}

async function scanByType(type: string, token: string | null, url: string): Promise<RawJob[] | null> {
  const need = (what: string): string => {
    if (!token) throw new ScanError(`Couldn't read the ${what} from the URL.`)
    return token
  }
  switch (type) {
    case 'greenhouse':
      return scanGreenhouse(need('Greenhouse board name'))
    case 'lever':
      return scanLever(need('Lever company name'))
    case 'ashby':
      return scanAshby(need('Ashby org name'))
    case 'workable':
      return scanWorkable(need('Workable account'))
    case 'smartrecruiters':
      return scanSmartRecruiters(need('SmartRecruiters company'))
    case 'recruitee':
      return scanRecruitee(url)
    case 'workday':
      return scanWorkday(url)
    default:
      return null
  }
}

/** Fetch the listing for a career URL. Returns the jobs plus the ATS it detected. */
export async function extractJobs(
  url: string,
  plan: SearchPlan = planSearch([], []),
): Promise<{ jobs: RawJob[]; ats: string; token: string | null; rendered?: boolean }> {
  try {
    new URL(url)
  } catch {
    throw new ScanError('That career page URL is not valid.')
  }

  // Big employers: search by your roles and locations.
  const big = detectBigTech(url)
  if (big) {
    const jobs =
      big.type === 'amazon'
        ? await searchAmazon(url, plan)
        : big.type === 'eightfold'
          ? await searchEightfold(url, big.token || 'microsoft.com', plan)
          : await searchGoogle(url, plan)
    return { jobs, ats: big.type, token: big.token }
  }

  const direct = detectAts(url)
  const viaApi = await scanByType(direct.type, direct.token, url)
  if (viaApi) return { jobs: viaApi, ats: direct.type, token: direct.token }

  // Custom careers page: look for an embedded board before reading links.
  let html: string
  try {
    html = await getText(url)
  } catch (e) {
    throw new ScanError(`Couldn't reach the page: ${(e as Error).message}`)
  }
  const embedded = detectAts(url, html)
  if (embedded.type !== 'custom' && embedded.token) {
    const embeddedUrl = embedded.type === 'workday' && embedded.host
      ? `https://${embedded.host}/${embedded.token.split('/')[1]}`
      : url
    const jobs = await scanByType(embedded.type, embedded.token, embeddedUrl)
    if (jobs) return { jobs, ats: embedded.type, token: embedded.token }
  }
  const jobs = genericJobs(html, url)
  if (jobs.length) return { jobs, ats: direct.type, token: null }

  // Nothing in the raw HTML: the page probably builds its list with
  // JavaScript. Render it once in a headless browser and look again.
  if (process.env.AUTO_APPLY_NO_RENDER !== '1') {
    try {
      const { renderPage } = await import('@/lib/apply/browser')
      const rendered = await renderPage(url)
      const again = detectAts(url, rendered)
      if (again.type !== 'custom' && again.token) {
        const viaEmbed = await scanByType(again.type, again.token, url)
        if (viaEmbed) return { jobs: viaEmbed, ats: again.type, token: again.token, rendered: true }
      }
      return { jobs: genericJobs(rendered, url), ats: direct.type, token: null, rendered: true }
    } catch (e) {
      console.warn('[autoapply.scanner] headless render failed:', (e as Error).message)
    }
  }
  return { jobs: [], ats: direct.type, token: null }
}

/** Canonical form for dedupe: drop fragments and tracking params. */
export function normUrl(u: string): string | null {
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
 * Fetch a company's career page, score jobs, sync to the DB. Always records the
 * outcome on the company row, even on failure.
 */
export async function scanCompany(company: Company, settings: Settings): Promise<ScanResult> {
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

async function scanCompanyInner(company: Company, settings: Settings): Promise<ScanResult> {
  const ctx = await buildScoreContext(settings)
  const plan = planSearch(
    settings.job_prefs.target_roles.length ? settings.job_prefs.target_roles : ctx.fallbackRoles,
    settings.job_prefs.locations,
    settings.profile.current_location || '',
  )
  let result: Awaited<ReturnType<typeof extractJobs>>
  try {
    result = await extractJobs(company.career_url, plan)
  } catch (e) {
    // ScanError carries a user-facing message already; anything else (network
    // failure, bad JSON from an ATS API) gets wrapped into one.
    const err =
      e instanceof ScanError
        ? e
        : new ScanError(
            e instanceof HttpStatusError && e.status === 429
              ? 'The careers site asked us to slow down (too many requests). It will be tried again on the next scheduled scan, or rescan in a few minutes.'
              : e instanceof SyntaxError
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
  for (const j of result.jobs) {
    const url = normUrl(j.url)
    const title = (j.title || '').replace(/\s+/g, ' ').trim()
    if (!url || !title || seen.has(url)) continue
    seen.add(url)
    const descHtml = j.description_html ? sanitizeHtml(j.description_html) : null
    const descText = descHtml ? htmlToText(descHtml).slice(0, 60_000) : null
    const { score, breakdown } = scoreJob(
      {
        title,
        location: j.location || null,
        description_text: descText,
        posted_at: j.posted_at ?? null,
        first_seen_at: nowIso(),
        company_id: company.id,
        company_priority: company.priority ?? 'normal',
      },
      ctx,
    )
    const matched = !breakdown.excluded && score >= settings.job_prefs.threshold
    clean.push({
      title: title.slice(0, 200),
      url,
      location: j.location || null,
      matched,
      match_reason: breakdown.excluded ?? (breakdown.skills_have.slice(0, 6).join(', ') || null),
      description_html: descHtml,
      description_text: descText,
      posted_at: j.posted_at ?? null,
      ats_job_id: j.ats_job_id ?? null,
      apply_url: j.apply_url ?? null,
      match_score: score,
      match_breakdown: JSON.stringify(breakdown),
    })
    if (clean.length >= MAX_JOBS_PER_COMPANY) break
  }

  // Search-based sites return a window of results, not the full list.
  const sync = await db.syncCompanyJobs(company.id, clean, { windowed: Boolean(detectBigTech(company.career_url)) })
  let status = 'ok'
  let error: string | null = null
  if (!clean.length) {
    status = 'empty'
    error = detectBigTech(company.career_url)
      ? `No openings matched "${plan.roles.join('", "')}"${plan.countryNames.length ? ` in ${plan.countryNames.join(', ')}` : ''}. ` +
        'Adjust your target roles and locations in Settings → Job preferences, then rescan.'
      : 'No job postings found on this page. Open the company’s actual job list (often on Greenhouse, ' +
        'Lever, Workday and similar) and add that URL instead.'
  }
  await db.updateCompany(company.id, {
    last_scanned_at: nowIso(),
    last_status: status,
    last_error: error,
    jobs_found: clean.length,
    ats_type: result.ats,
    ats_token: result.token,
  })

  // Descriptions the list API didn't include are fetched by the worker.
  if (sync.needs_jd_ids.length) {
    const { enqueue } = await import('@/lib/tasks/queue')
    for (const id of sync.needs_jd_ids.slice(0, 200)) {
      await enqueue('jobs.fetch_jd', { job_id: id }, { dedupeKey: `jd:${id}` })
    }
  }

  console.log(
    `[autoapply.scanner] Scanned ${company.name} (${result.ats}): ${sync.found} found, ` +
      `${sync.new} new, ${sync.matched} matched, ${sync.needs_jd_ids.length} need JD`,
  )
  return { found: sync.found, new: sync.new, matched: sync.matched, gone: sync.gone }
}

