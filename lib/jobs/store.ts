/** Job queries for the Jobs pages, the rescore task and the JD fetcher. */
import { parseJson, sql } from '@/lib/server/db'
import type { SqlParam } from '@/lib/server/db'
import * as settingsStore from '@/lib/server/settings'
import type { JobDetail, JobListItem, JobState, ScoreBreakdown } from '@/lib/types'

import { analyzeJd, requirementsLine } from './analyze'
import { buildScoreContext } from './context'
import { scoreJob } from './score'

const LIST_COLS = `j.id, j.company_id, c.name AS company_name, j.title, j.location, j.url, j.apply_url,
  COALESCE(c.ats_type, 'custom') AS ats_type, j.posted_at, j.first_seen_at, j.match_score, j.match_breakdown,
  j.state, j.active, CASE WHEN j.description_text IS NULL OR j.description_text = '' THEN 0 ELSE 1 END AS has_description,
  (SELECT s.id FROM apply_sessions s WHERE s.job_id = j.id AND s.status != 'cancelled' ORDER BY s.id DESC LIMIT 1) AS session_id,
  (SELECT s.status FROM apply_sessions s WHERE s.job_id = j.id AND s.status != 'cancelled' ORDER BY s.id DESC LIMIT 1) AS session_status`

function toItem(r: Record<string, unknown>): JobListItem {
  return {
    id: Number(r.id),
    company_id: Number(r.company_id),
    company_name: String(r.company_name ?? ''),
    title: String(r.title ?? ''),
    location: (r.location as string) ?? null,
    url: String(r.url ?? ''),
    apply_url: (r.apply_url as string) ?? null,
    ats_type: (r.ats_type as string) ?? null,
    posted_at: (r.posted_at as string) ?? null,
    first_seen_at: String(r.first_seen_at ?? ''),
    match_score: r.match_score == null ? null : Number(r.match_score),
    match_breakdown: parseJson<ScoreBreakdown>(r.match_breakdown),
    state: String(r.state) as JobState,
    active: Number(r.active ?? 0),
    has_description: Number(r.has_description) === 1,
    session_id: r.session_id == null ? null : Number(r.session_id),
    session_status: (r.session_status as string) ?? null,
  }
}

/** Everything the Jobs filter panel can narrow by. Empty lists mean "any". */
export interface JobFilters {
  companies?: number[]
  cities?: string[]
  countries?: string[]
  /** remote | hybrid | onsite | unspecified */
  workModes?: string[]
  /** full-time | internship | contract | part-time | temporary | unspecified */
  types?: string[]
  /** intern | new_grad | junior | mid | senior | unspecified */
  seniority?: string[]
  /** Hide jobs that ask for more than this many years (jobs that don't say are kept). */
  maxYears?: number | null
  /** bachelors | masters | phd | none (no degree mentioned) */
  education?: string[]
  /** The job must mention every one of these skills. */
  skills?: string[]
  /** Posted (or first seen) within this many days. */
  postedDays?: number | null
  onlyNew?: boolean
  hideStarted?: boolean
  withSalary?: boolean
  withDescription?: boolean
}

export interface ListJobsOpts extends JobFilters {
  view?: 'relevant' | 'all' | 'shortlisted' | 'applied' | 'dismissed'
  q?: string | null
  companyId?: number | null
  minScore?: number | null
  sort?: 'score' | 'newest' | 'company'
  limit?: number
  offset?: number
}

/** The view (tab) and search: what the filters further narrow, and what their counts are computed over. */
function viewClauses(opts: ListJobsOpts, threshold: number, where: string[], params: SqlParam[]): void {
  const view = opts.view ?? 'relevant'
  if (view === 'relevant') {
    where.push("j.active = 1 AND j.state NOT IN ('dismissed') AND COALESCE(j.match_score, 0) >= ?")
    params.push(opts.minScore ?? threshold)
  } else if (view === 'all') {
    where.push("j.active = 1 AND j.state != 'dismissed'")
    if (opts.minScore) {
      where.push('COALESCE(j.match_score, 0) >= ?')
      params.push(opts.minScore)
    }
  } else if (view === 'shortlisted') where.push("j.state = 'shortlisted'")
  else if (view === 'applied') where.push("j.state = 'applied'")
  else if (view === 'dismissed') where.push("j.state = 'dismissed'")
  if (opts.q) {
    where.push(`(j.title ${sql.LIKE} ? OR c.name ${sql.LIKE} ? OR j.location ${sql.LIKE} ?)`)
    const like = `%${opts.q}%`
    params.push(like, like, like)
  }
}

/** "x IN (…)" with an "unspecified" option that matches NULL. */
function inList(col: string, values: string[] | undefined, where: string[], params: SqlParam[], unspecified = 'unspecified'): void {
  if (!values?.length) return
  const real = values.filter((v) => v !== unspecified)
  const parts: string[] = []
  if (real.length) {
    parts.push(`${col} IN (${real.map(() => '?').join(',')})`)
    params.push(...real)
  }
  if (values.includes(unspecified)) parts.push(`${col} IS NULL`)
  where.push(`(${parts.join(' OR ')})`)
}

/** The filter panel's conditions, skipping `except` (so a facet's own counts ignore its own selection). */
function filterClauses(f: JobFilters, where: string[], params: SqlParam[], except: keyof JobFilters | null = null): void {
  const on = (k: keyof JobFilters) => k !== except
  if (on('companies') && f.companies?.length) {
    where.push(`j.company_id IN (${f.companies.map(() => '?').join(',')})`)
    params.push(...f.companies)
  }
  if (on('cities')) inList('j.city', f.cities, where, params)
  if (on('countries')) inList('j.country', f.countries, where, params)
  if (on('workModes')) inList('j.work_mode', f.workModes, where, params)
  if (on('types')) inList('j.employment_type', f.types, where, params)
  if (on('seniority')) inList('j.seniority', f.seniority, where, params)
  if (on('education')) inList('j.edu_level', f.education, where, params, 'none')
  if (on('maxYears') && f.maxYears != null) {
    where.push('(j.exp_min IS NULL OR j.exp_min <= ?)')
    params.push(f.maxYears)
  }
  if (on('skills')) {
    for (const s of f.skills ?? []) {
      where.push(`j.skills ${sql.LIKE} ?`)
      params.push(`%|${s}|%`)
    }
  }
  if (on('postedDays') && f.postedDays) {
    where.push('COALESCE(j.posted_at, j.first_seen_at) >= ?')
    params.push(new Date(Date.now() - f.postedDays * 86_400_000).toISOString().slice(0, 10))
  }
  if (on('onlyNew') && f.onlyNew) where.push("j.state = 'new'")
  if (on('hideStarted') && f.hideStarted) where.push("NOT EXISTS (SELECT 1 FROM apply_sessions s WHERE s.job_id = j.id AND s.status != 'cancelled')")
  if (on('withSalary') && f.withSalary) where.push('j.has_salary = 1')
  if (on('withDescription') && f.withDescription) where.push("j.description_text IS NOT NULL AND j.description_text != ''")
}

export interface JobFacets {
  companies: { id: number; name: string; n: number }[]
  cities: { value: string; n: number }[]
  countries: { value: string; n: number }[]
  workModes: { value: string; n: number }[]
  types: { value: string; n: number }[]
  seniority: { value: string; n: number }[]
  education: { value: string; n: number }[]
  skills: { value: string; n: number }[]
  /** Jobs that would remain at each "max years" setting. */
  maxYears: { value: number; n: number }[]
  postedDays: { value: number; n: number }[]
}

/**
 * Counts for every filter option, over the current tab and search. Each
 * facet ignores its own selection (so you can see what picking another value
 * would give) but respects all the others. Same posting in several cities
 * counts once, like the list.
 */
export async function jobFacets(opts: ListJobsOpts): Promise<JobFacets> {
  const threshold = settingsStore.load().job_prefs.threshold
  const rowsFor = async (except: keyof JobFilters) => {
    const where: string[] = []
    const params: SqlParam[] = []
    viewClauses(opts, threshold, where, params)
    filterClauses(opts, where, params, except)
    if (opts.companyId && except !== 'companies') {
      where.push('j.company_id = ?')
      params.push(opts.companyId)
    }
    const rows = await sql.all(
      `SELECT j.company_id, c.name AS company_name, lower(j.title) AS t, j.city, j.country, j.work_mode, j.employment_type,
              j.seniority, j.edu_level, j.exp_min, j.skills, COALESCE(j.posted_at, j.first_seen_at) AS posted
       FROM company_jobs j JOIN companies c ON c.id = j.company_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      params,
    )
    const seen = new Set<string>()
    return rows.filter((r) => {
      const k = `${r.company_id}|${r.t}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  const count = (rows: Record<string, unknown>[], key: string, none = 'unspecified') => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const v = r[key] == null || r[key] === '' ? none : String(r[key])
      m.set(v, (m.get(v) ?? 0) + 1)
    }
    // Real values first (most jobs first); "not stated" always last.
    return [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => Number(a.value === none) - Number(b.value === none) || b.n - a.n)
  }
  const [rc, rCity, rCountry, rMode, rType, rSen, rEdu, rSkill, rYears, rPosted] = await Promise.all([
    rowsFor('companies'), rowsFor('cities'), rowsFor('countries'), rowsFor('workModes'), rowsFor('types'),
    rowsFor('seniority'), rowsFor('education'), rowsFor('skills'), rowsFor('maxYears'), rowsFor('postedDays'),
  ])
  const companies = new Map<number, { id: number; name: string; n: number }>()
  for (const r of rc) {
    const id = Number(r.company_id)
    const e = companies.get(id) ?? { id, name: String(r.company_name), n: 0 }
    e.n++
    companies.set(id, e)
  }
  const skillCounts = new Map<string, number>()
  for (const r of rSkill) for (const s of String(r.skills ?? '').split('|').filter(Boolean)) skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1)
  const now = Date.now()
  return {
    companies: [...companies.values()].sort((a, b) => b.n - a.n),
    cities: count(rCity, 'city').slice(0, 40),
    countries: count(rCountry, 'country'),
    workModes: count(rMode, 'work_mode'),
    types: count(rType, 'employment_type'),
    seniority: count(rSen, 'seniority'),
    education: count(rEdu, 'edu_level', 'none'),
    skills: [...skillCounts.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n).slice(0, 60),
    maxYears: [0, 1, 2, 3, 5].map((y) => ({ value: y, n: rYears.filter((r) => r.exp_min == null || Number(r.exp_min) <= y).length })),
    postedDays: [1, 3, 7, 14, 30].map((d) => ({
      value: d,
      n: rPosted.filter((r) => r.posted && Date.parse(String(r.posted)) >= now - d * 86_400_000).length,
    })),
  }
}

export async function listJobs(opts: ListJobsOpts = {}): Promise<{ items: JobListItem[]; total: number }> {
  const threshold = settingsStore.load().job_prefs.threshold
  const where: string[] = []
  const params: SqlParam[] = []
  const view = opts.view ?? 'relevant'
  viewClauses(opts, threshold, where, params)
  filterClauses(opts, where, params)
  if (opts.companyId) {
    where.push('j.company_id = ?')
    params.push(opts.companyId)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  // Ordering on the grouped result's own columns.
  const order =
    opts.sort === 'newest'
      ? 'COALESCE(posted_at, first_seen_at) DESC, id DESC'
      : opts.sort === 'company'
        ? 'company_name, COALESCE(match_score, 0) DESC'
        : 'COALESCE(match_score, 0) DESC, COALESCE(posted_at, first_seen_at) DESC, id DESC'
  // The same posting listed once per city (same company, same title) is one
  // row with "+N more locations" — except in lists of things you acted on.
  const group = view === 'relevant' || view === 'all'
  const key = 'j.company_id, lower(j.title)'
  const total = Number(
    (await sql.one(
      group
        ? `SELECT COUNT(*) AS n FROM (SELECT 1 AS x FROM company_jobs j JOIN companies c ON c.id = j.company_id ${whereSql} GROUP BY ${key}) g`
        : `SELECT COUNT(*) AS n FROM company_jobs j JOIN companies c ON c.id = j.company_id ${whereSql}`,
      params,
    ))?.n ?? 0,
  )
  const rows = await sql.all(
    `SELECT * FROM (
       SELECT ${LIST_COLS},
         ROW_NUMBER() OVER (PARTITION BY ${key} ORDER BY COALESCE(j.match_score, 0) DESC, j.id) AS grp_rank,
         COUNT(*) OVER (PARTITION BY ${key}) AS grp_size
       FROM company_jobs j JOIN companies c ON c.id = j.company_id ${whereSql}
     ) t ${group ? 'WHERE grp_rank = 1' : ''}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, Math.min(opts.limit ?? 100, 500), opts.offset ?? 0],
  )
  return { items: rows.map((r) => ({ ...toItem(r), more_locations: group ? Math.max(0, Number(r.grp_size ?? 1) - 1) : 0 })), total }
}

/** Other open postings with the same title at the same company (one per city). */
async function siblingsOf(id: number, companyId: number, title: string): Promise<{ id: number; location: string | null }[]> {
  const rows = await sql.all(
    "SELECT id, location FROM company_jobs WHERE company_id = ? AND lower(title) = lower(?) AND id != ? AND active = 1 AND state != 'dismissed' ORDER BY location LIMIT 40",
    [companyId, title, id],
  )
  return rows.map((r) => ({ id: Number(r.id), location: (r.location as string) ?? null }))
}

export async function getJob(id: number): Promise<JobDetail | null> {
  const r = await sql.one(
    `SELECT ${LIST_COLS}, j.description_html, j.description_text, j.jd_fetched_at
     FROM company_jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
    [id],
  )
  if (!r) return null
  const sessions = await sql.all(
    'SELECT id, status, stage, started_at FROM apply_sessions WHERE job_id = ? ORDER BY id DESC',
    [id],
  )
  const text = (r.description_text as string) || ''
  const jd = text ? analyzeJd(String(r.title), text) : null
  return {
    ...toItem(r),
    description_html: (r.description_html as string) ?? null,
    description_text: text || null,
    jd_fetched_at: (r.jd_fetched_at as string) ?? null,
    keywords: jd ? { required: jd.required, preferred: jd.preferred } : null,
    requirements: jd
      ? { experience: jd.experience, experience_preferred: jd.experience_preferred, ...jd.details, summary: requirementsLine(jd) }
      : null,
    siblings: await siblingsOf(Number(r.id), Number(r.company_id), String(r.title)),
    sessions: sessions.map((s) => ({
      id: Number(s.id),
      status: String(s.status),
      stage: (s.stage as string) ?? null,
      started_at: String(s.started_at),
    })),
  }
}

export async function setJobState(id: number, state: JobState): Promise<void> {
  await sql.run('UPDATE company_jobs SET state = ? WHERE id = ?', [state, id])
}

export async function saveJobDescription(
  id: number,
  fields: { description_html: string | null; description_text: string | null; posted_at?: string | null; error?: string | null },
): Promise<void> {
  await sql.run(
    'UPDATE company_jobs SET description_html = COALESCE(?, description_html), description_text = COALESCE(?, description_text), ' +
      'posted_at = COALESCE(?, posted_at), jd_fetched_at = ?, jd_error = ? WHERE id = ?',
    [fields.description_html, fields.description_text, fields.posted_at ?? null, sql.nowIso(), fields.error ?? null, id],
  )
  await rescoreJobs([id])
}

const CITY_ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru', bengaluru: 'Bengaluru', gurgaon: 'Gurugram', gurugram: 'Gurugram', bombay: 'Mumbai',
  madras: 'Chennai', 'new delhi': 'Delhi', delhi: 'Delhi', 'nyc': 'New York', 'new york city': 'New York',
}
const COUNTRY_ALIASES: Record<string, string> = {
  ind: 'India', in: 'India', india: 'India', usa: 'United States', us: 'United States', 'united states': 'United States',
  'united states of america': 'United States', uk: 'United Kingdom', gbr: 'United Kingdom', 'united kingdom': 'United Kingdom',
  can: 'Canada', canada: 'Canada', deu: 'Germany', germany: 'Germany', irl: 'Ireland', ireland: 'Ireland', sgp: 'Singapore',
  singapore: 'Singapore', isr: 'Israel', israel: 'Israel', jpn: 'Japan', japan: 'Japan', aus: 'Australia', australia: 'Australia',
  che: 'Switzerland', switzerland: 'Switzerland', pol: 'Poland', poland: 'Poland', are: 'UAE', uae: 'UAE', fra: 'France', france: 'France',
  nld: 'Netherlands', netherlands: 'Netherlands',
}
const US_STATES = /^(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)$/i

/** First city and its country from a location string ("Mountain View, CA, USA; …" → Mountain View / United States). */
export function placeOf(location: string | null): { city: string | null; country: string | null } {
  const first = (location || '').split(/;|\||\/| or /)[0].trim()
  if (!first) return { city: null, country: null }
  if (/^remote\b/i.test(first)) return { city: 'Remote', country: null }
  const parts = first.split(',').map((x) => x.trim()).filter(Boolean)
  const rawCity = parts[0] || ''
  const city = CITY_ALIASES[rawCity.toLowerCase()] ?? rawCity
  let country: string | null = null
  for (const p of [...parts.slice(1)].reverse()) {
    const c = COUNTRY_ALIASES[p.toLowerCase()]
    if (c) {
      country = c
      break
    }
  }
  if (!country && parts.length >= 2 && US_STATES.test(parts[parts.length - 1])) country = 'United States'
  if (!country && /\b(bengaluru|bangalore|hyderabad|chennai|mumbai|pune|delhi|gurugram|gurgaon|noida|kolkata|ahmedabad|kochi)\b/i.test(first)) country = 'India'
  return { city: city.slice(0, 60) || null, country }
}

/** What the Jobs filters look at, read once when a job is scored. */
export function filterFields(title: string, location: string | null, text: string) {
  const a = analyzeJd(title, text)
  const place = placeOf(location)
  const skills = [...a.required, ...a.preferred]
  return {
    exp_min: a.experience ? a.experience.min : null,
    exp_max: a.experience ? a.experience.max : null,
    work_mode: a.details.work_mode ?? (/\bremote\b/i.test(location || '') ? 'remote' : null),
    employment_type: a.details.employment_type,
    seniority: a.seniority,
    edu_level: a.details.education?.level ?? null,
    skills: skills.length ? `|${skills.join('|')}|` : null,
    city: place.city,
    country: place.country,
    has_salary: a.details.salary ? 1 : 0,
    visa: a.details.visa,
  }
}

/** Re-score jobs (all active ones when ids is omitted). Returns how many were scored. */
export async function rescoreJobs(ids?: number[]): Promise<number> {
  const settings = settingsStore.load()
  const ctx = await buildScoreContext(settings)
  const where = ids?.length ? `j.id IN (${ids.map(() => '?').join(',')})` : 'j.active = 1'
  const rows = await sql.all(
    `SELECT j.id, j.title, j.location, j.description_text, j.posted_at, j.first_seen_at, j.company_id, c.priority
     FROM company_jobs j JOIN companies c ON c.id = j.company_id WHERE ${where}`,
    ids ?? [],
  )
  for (const r of rows) {
    const { score, breakdown } = scoreJob(
      {
        title: String(r.title),
        location: (r.location as string) ?? null,
        description_text: (r.description_text as string) ?? null,
        posted_at: (r.posted_at as string) ?? null,
        first_seen_at: (r.first_seen_at as string) ?? null,
        company_id: Number(r.company_id),
        company_priority: (r.priority as string) ?? 'normal',
      },
      ctx,
    )
    const matched = !breakdown.excluded && score >= settings.job_prefs.threshold ? 1 : 0
    const f = filterFields(String(r.title), (r.location as string) ?? null, (r.description_text as string) ?? '')
    await sql.run(
      'UPDATE company_jobs SET match_score = ?, match_breakdown = ?, matched = ?, exp_min = ?, exp_max = ?, work_mode = ?, ' +
        'employment_type = ?, seniority = ?, edu_level = ?, skills = ?, city = ?, country = ?, has_salary = ?, visa = ? WHERE id = ?',
      [
        score, JSON.stringify(breakdown), matched, f.exp_min, f.exp_max, f.work_mode, f.employment_type, f.seniority,
        f.edu_level, f.skills, f.city, f.country, f.has_salary, f.visa, Number(r.id),
      ],
    )
  }
  return rows.length
}

/** How many active jobs would be relevant under a candidate set of preferences (live slider count). */
export async function previewRelevantCount(prefsPatch: Partial<import('@/lib/types').JobPrefs>): Promise<{ relevant: number; total: number }> {
  const settings = settingsStore.load()
  const merged = { ...settings, job_prefs: { ...settings.job_prefs, ...prefsPatch } }
  const ctx = await buildScoreContext(merged)
  const rows = await sql.all(
    `SELECT j.title, j.location, j.description_text, j.posted_at, j.first_seen_at, j.company_id, c.priority
     FROM company_jobs j JOIN companies c ON c.id = j.company_id WHERE j.active = 1 AND j.state != 'dismissed'`,
  )
  let relevant = 0
  for (const r of rows) {
    const { score, breakdown } = scoreJob(
      {
        title: String(r.title),
        location: (r.location as string) ?? null,
        description_text: (r.description_text as string) ?? null,
        posted_at: (r.posted_at as string) ?? null,
        first_seen_at: (r.first_seen_at as string) ?? null,
        company_id: Number(r.company_id),
        company_priority: (r.priority as string) ?? 'normal',
      },
      ctx,
    )
    if (!breakdown.excluded && score >= merged.job_prefs.threshold) relevant++
  }
  return { relevant, total: rows.length }
}

export async function jobRowForFetch(id: number): Promise<{
  id: number
  url: string
  title: string
  ats_job_id: string | null
  ats_type: string | null
  ats_token: string | null
  career_url: string
} | null> {
  const r = await sql.one(
    `SELECT j.id, j.url, j.title, j.ats_job_id, c.ats_type, c.ats_token, c.career_url
     FROM company_jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
    [id],
  )
  if (!r) return null
  return {
    id: Number(r.id),
    url: String(r.url),
    title: String(r.title),
    ats_job_id: (r.ats_job_id as string) ?? null,
    ats_type: (r.ats_type as string) ?? null,
    ats_token: (r.ats_token as string) ?? null,
    career_url: String(r.career_url),
  }
}
