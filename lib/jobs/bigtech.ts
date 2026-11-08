/**
 * Big employers that run their own careers sites rather than a shared ATS.
 * They hold thousands of openings worldwide, so instead of listing everything
 * we *search* them with your target roles and locations (Settings → Job
 * preferences), the same way you would on their site.
 *
 *   Amazon     amazon.jobs                     public search.json (descriptions included)
 *   Microsoft  apply.careers.microsoft.com     Eightfold PCSX search (+ details per job)
 *   Eightfold  <company>.eightfold.ai          same API, any Eightfold-hosted company
 *   Google     google.com/about/careers        server-rendered results pages
 *
 * If you paste a search URL (e.g. amazon.jobs/en/search?base_query=sde&country=IND)
 * its own query is used as-is instead of your preferences.
 */
import { decodeEntities } from './html'
import { HttpStatusError, asArray, getJson, getText, prop, str } from './fetch'

export type BigTechType = 'amazon' | 'eightfold' | 'google'

export interface SearchPlan {
  roles: string[]
  /** Free-text locations from preferences ("Bengaluru", "India", "Remote"). */
  locations: string[]
  /** ISO-3166 alpha-3 codes derived from the locations (Amazon filters on these). */
  countries3: string[]
  /** Country names (Microsoft/Google take plain names). */
  countryNames: string[]
}

export interface BigTechJob {
  title: string
  url: string
  location: string | null
  description_html?: string | null
  posted_at?: string | null
  ats_job_id?: string | null
}

const PER_ROLE_CAP = 150
const TOTAL_CAP = 400

// ---------- detection ----------

export function detectBigTech(url: string): { type: BigTechType; token: string | null } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.host.toLowerCase()
  if (host === 'amazon.jobs' || host.endsWith('.amazon.jobs')) return { type: 'amazon', token: null }
  if (/(^|\.)careers\.microsoft\.com$/.test(host)) return { type: 'eightfold', token: 'microsoft.com' }
  if (host.endsWith('.eightfold.ai')) {
    return { type: 'eightfold', token: u.searchParams.get('domain') || `${host.split('.')[0]}.com` }
  }
  if ((host === 'www.google.com' || host === 'google.com' || host === 'careers.google.com') &&
    (host === 'careers.google.com' || u.pathname.startsWith('/about/careers'))) {
    return { type: 'google', token: null }
  }
  return null
}

// ---------- locations → country filters ----------

const COUNTRIES: [RegExp, string, string][] = [
  [/\b(india|bharat|bengaluru|bangalore|hyderabad|chennai|pune|mumbai|delhi|new delhi|noida|gurgaon|gurugram|kolkata|ahmedabad|kochi|cochin|coimbatore|trivandrum|thiruvananthapuram|jaipur|indore|chandigarh|mysore|mysuru|visakhapatnam|vizag|nagpur|bhubaneswar|vadodara)\b/i, 'IND', 'India'],
  [/\b(united states|usa|u\.s\.|seattle|new york|san francisco|bay area|austin|boston|redmond|sunnyvale|mountain view|cupertino|chicago)\b/i, 'USA', 'United States'],
  [/\b(united kingdom|uk|london|edinburgh|manchester|cambridge)\b/i, 'GBR', 'United Kingdom'],
  [/\b(canada|toronto|vancouver|montreal)\b/i, 'CAN', 'Canada'],
  [/\b(germany|berlin|munich|münchen)\b/i, 'DEU', 'Germany'],
  [/\b(ireland|dublin)\b/i, 'IRL', 'Ireland'],
  [/\b(singapore)\b/i, 'SGP', 'Singapore'],
  [/\b(australia|sydney|melbourne)\b/i, 'AUS', 'Australia'],
  [/\b(netherlands|amsterdam)\b/i, 'NLD', 'Netherlands'],
  [/\b(united arab emirates|uae|dubai|abu dhabi)\b/i, 'ARE', 'United Arab Emirates'],
  [/\b(japan|tokyo)\b/i, 'JPN', 'Japan'],
  [/\b(poland|warsaw|krakow|gdansk)\b/i, 'POL', 'Poland'],
]

export function planSearch(roles: string[], locations: string[], fallbackLocation = ''): SearchPlan {
  const locs = locations.map((l) => l.trim()).filter(Boolean)
  const source = locs.length ? locs : fallbackLocation ? [fallbackLocation] : []
  const countries3: string[] = []
  const countryNames: string[] = []
  for (const l of source) {
    for (const [re, iso3, name] of COUNTRIES) {
      if (re.test(l) && !countries3.includes(iso3)) {
        countries3.push(iso3)
        countryNames.push(name)
      }
    }
  }
  const cleanRoles: string[] = []
  for (const r of roles.map((x) => x.trim()).filter(Boolean)) {
    if (!cleanRoles.some((c) => c.toLowerCase() === r.toLowerCase())) cleanRoles.push(r)
  }
  cleanRoles.splice(5)
  return { roles: cleanRoles.length ? cleanRoles : ['Software Engineer'], locations: source, countries3, countryNames }
}

// ---------- Amazon ----------

function amazonDate(s: string): string | null {
  // "November  6, 2026"
  const t = Date.parse(s.replace(/\s+/g, ' '))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function amazonJob(j: unknown): BigTechJob | null {
  const path = str(prop(j, 'job_path'))
  const title = str(prop(j, 'title'))
  if (!path || !title) return null
  const section = (h: string, body: string) => (body ? `<h3>${h}</h3><p>${body}</p>` : '')
  const html = [
    section('Description', str(prop(j, 'description'))),
    section('Basic qualifications', str(prop(j, 'basic_qualifications'))),
    section('Preferred qualifications', str(prop(j, 'preferred_qualifications'))),
  ].join('')
  return {
    title,
    url: `https://www.amazon.jobs${path}`,
    location: str(prop(j, 'normalized_location')) || str(prop(j, 'location')) || null,
    description_html: html || null,
    posted_at: amazonDate(str(prop(j, 'posted_date'))),
    ats_job_id: str(prop(j, 'id_icims')) || null,
  }
}

async function amazonQuery(params: URLSearchParams, cap: number): Promise<BigTechJob[]> {
  const out: BigTechJob[] = []
  for (let offset = 0; offset < cap; offset += 100) {
    params.set('result_limit', '100')
    params.set('offset', String(offset))
    if (!params.has('sort')) params.set('sort', 'recent')
    const data = await getJson(`https://www.amazon.jobs/en/search.json?${params}`)
    const jobs = asArray(prop(data, 'jobs'))
    for (const j of jobs) {
      const job = amazonJob(j)
      if (job) out.push(job)
    }
    const hits = Number(prop(data, 'hits') ?? 0)
    if (jobs.length < 100 || offset + 100 >= hits) break
  }
  return out
}

export async function searchAmazon(url: string, plan: SearchPlan): Promise<BigTechJob[]> {
  const u = new URL(url)
  // A pasted search with its own keywords is used as-is.
  if ((u.searchParams.get('base_query') || '').trim()) {
    return amazonQuery(new URLSearchParams(u.searchParams), TOTAL_CAP)
  }
  // Otherwise search each of your roles. Location filters in a pasted URL
  // (country, city…) win over your preferences; an empty keyword box never
  // means "everything" (that pulled 400 unrelated jobs before).
  const pastedCountry = u.searchParams.get('country') || u.searchParams.getAll('country[]').length
  const all: BigTechJob[] = []
  for (const role of plan.roles) {
    const p = new URLSearchParams()
    for (const [k, v] of u.searchParams) if (k !== 'base_query' && k !== 'offset' && k !== 'result_limit') p.append(k, v)
    p.set('base_query', role)
    if (!pastedCountry) {
      for (const c of plan.countries3) p.append('country[]', c)
      // A single country also works as a plain param, which the API honours most reliably.
      if (plan.countries3.length === 1) p.set('country', plan.countries3[0])
    }
    all.push(...(await amazonQuery(p, PER_ROLE_CAP)))
    if (all.length >= TOTAL_CAP) break
  }
  return all
}

// ---------- Eightfold (Microsoft and others) ----------

function eightfoldBase(url: string, domain: string): string {
  const host = new URL(url).host.toLowerCase()
  return domain === 'microsoft.com' || host.endsWith('careers.microsoft.com')
    ? 'https://apply.careers.microsoft.com'
    : `https://${host}`
}

export async function searchEightfold(url: string, domain: string, plan: SearchPlan): Promise<BigTechJob[]> {
  const base = eightfoldBase(url, domain)
  const u = new URL(url)
  const pasted = u.searchParams.get('query') || u.searchParams.get('q')
  const queries = pasted ? [pasted] : plan.roles
  const locations = u.searchParams.get('location') ? [u.searchParams.get('location')!] : plan.countryNames.length ? plan.countryNames : ['']
  const out: BigTechJob[] = []
  for (const q of queries) {
    for (const loc of locations) {
      // Fewer pages than other sites: this API rate-limits quickly.
      for (let start = 0; start < 60; start += 20) {
        const p = new URLSearchParams({ domain, query: q, start: String(start), num: '20', sort_by: 'timestamp' })
        if (loc) p.set('location', loc)
        let data: unknown
        try {
          data = await getJson(`${base}/api/pcsx/search?${p}`)
        } catch (e) {
          // Keep what we already have if the site asks us to slow down mid-scan.
          if (e instanceof HttpStatusError && e.status === 429 && out.length) return out
          throw e
        }
        const positions = asArray(prop(prop(data, 'data'), 'positions'))
        for (const pos of positions) {
          const id = String(prop(pos, 'id') ?? '')
          const title = str(prop(pos, 'name'))
          if (!id || !title) continue
          const locs = asArray(prop(pos, 'standardizedLocations')).map(String)
          const raw = asArray(prop(pos, 'locations')).map(String)
          const ts = Number(prop(pos, 'postedTs') ?? 0)
          out.push({
            title,
            url: `${base}${str(prop(pos, 'positionUrl')) || `/careers/job/${id}`}`,
            location: (raw.length ? raw : locs).slice(0, 3).join('; ') || null,
            posted_at: ts ? new Date(ts * 1000).toISOString() : null,
            ats_job_id: id,
          })
        }
        if (positions.length < 20) break
      }
      if (out.length >= TOTAL_CAP) return out
    }
  }
  return out
}

/** Full description for one Eightfold position (the search API omits it). */
export async function eightfoldDetails(jobUrl: string, positionId: string, domain: string): Promise<{ html: string; posted_at: string | null }> {
  const base = eightfoldBase(jobUrl, domain)
  const data = await getJson(`${base}/api/pcsx/position_details?${new URLSearchParams({ position_id: positionId, domain, hl: 'en' })}`)
  const d = prop(data, 'data')
  const ts = Number(prop(d, 'postedTs') ?? 0)
  return { html: str(prop(d, 'jobDescription')), posted_at: ts ? new Date(ts * 1000).toISOString() : null }
}

// ---------- Google ----------

/** Parse one results page: each card has a "Learn more about <title>" link and a location line. */
export function parseGoogleResults(html: string, pageUrl: string): BigTechJob[] {
  const out: BigTechJob[] = []
  const linkRe = /<a[^>]+href="(jobs\/results\/(\d{6,})-[^"?]*)[^"]*"[^>]*aria-label="Learn more about ([^"]+)"/g
  let m: RegExpExecArray | null
  let lastIndex = 0
  while ((m = linkRe.exec(html))) {
    const chunk = html.slice(lastIndex, m.index)
    lastIndex = m.index
    // The card's location paragraph comes just before its link.
    const locBlock = /class="l103df">([\s\S]*?)<\/p>/g
    let loc: RegExpExecArray | null
    let lastLoc = ''
    while ((loc = locBlock.exec(chunk))) lastLoc = loc[1]
    const locText = decodeEntities(lastLoc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
      .replace(/^(\s*[^|;]{1,40}\|)+\s*/, '') // "Google | YouTube | Bengaluru…" → "Bengaluru…"
      .replace(/\s*;\s*/g, '; ')
      .trim()
    const quals = /<h4>Minimum qualifications:?<\/h4>\s*(?:<div>)?\s*(<ul>[\s\S]*?<\/ul>)/.exec(chunk)?.[1]
    out.push({
      title: decodeEntities(m[3]).trim(),
      url: new URL(`/about/careers/applications/${m[1]}`, pageUrl).toString(),
      location: locText || null,
      description_html: quals ? `<h3>Minimum qualifications</h3>${quals}` : null,
      ats_job_id: m[2],
    })
  }
  return out
}

export async function searchGoogle(url: string, plan: SearchPlan): Promise<BigTechJob[]> {
  const u = new URL(url)
  const pasted = u.searchParams.get('q')
  const queries = pasted ? [pasted] : plan.roles
  const locations = u.searchParams.getAll('location').length ? u.searchParams.getAll('location') : plan.countryNames.length ? plan.countryNames : ['']
  const out: BigTechJob[] = []
  const seen = new Set<string>()
  for (const q of queries) {
    for (let page = 1; page <= 5; page++) {
      const p = new URLSearchParams({ q })
      for (const l of locations) if (l) p.append('location', l)
      if (page > 1) p.set('page', String(page))
      const pageUrl = `https://www.google.com/about/careers/applications/jobs/results?${p}`
      const jobs = parseGoogleResults(await getText(pageUrl), pageUrl)
      const fresh = jobs.filter((j) => !seen.has(j.ats_job_id!))
      for (const j of fresh) {
        seen.add(j.ats_job_id!)
        out.push(j)
      }
      if (!fresh.length || jobs.length < 20) break
    }
    if (out.length >= TOTAL_CAP) break
  }
  return out
}
