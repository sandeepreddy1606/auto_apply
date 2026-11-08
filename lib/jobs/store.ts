/** Job queries for the Jobs pages, the rescore task and the JD fetcher. */
import { parseJson, sql } from '@/lib/server/db'
import type { SqlParam } from '@/lib/server/db'
import * as settingsStore from '@/lib/server/settings'
import type { JobDetail, JobListItem, JobState, ScoreBreakdown } from '@/lib/types'

import { analyzeJd } from './analyze'
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

export interface ListJobsOpts {
  view?: 'relevant' | 'all' | 'shortlisted' | 'applied' | 'dismissed'
  q?: string | null
  companyId?: number | null
  minScore?: number | null
  sort?: 'score' | 'newest' | 'company'
  limit?: number
  offset?: number
}

export async function listJobs(opts: ListJobsOpts = {}): Promise<{ items: JobListItem[]; total: number }> {
  const threshold = settingsStore.load().job_prefs.threshold
  const where: string[] = []
  const params: SqlParam[] = []
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
  if (opts.companyId) {
    where.push('j.company_id = ?')
    params.push(opts.companyId)
  }
  if (opts.q) {
    where.push(`(j.title ${sql.LIKE} ? OR c.name ${sql.LIKE} ? OR j.location ${sql.LIKE} ?)`)
    const like = `%${opts.q}%`
    params.push(like, like, like)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const order =
    opts.sort === 'newest'
      ? 'COALESCE(j.posted_at, j.first_seen_at) DESC, j.id DESC'
      : opts.sort === 'company'
        ? 'c.name, COALESCE(j.match_score, 0) DESC'
        : 'COALESCE(j.match_score, 0) DESC, COALESCE(j.posted_at, j.first_seen_at) DESC'
  const total = Number(
    (await sql.one(`SELECT COUNT(*) AS n FROM company_jobs j JOIN companies c ON c.id = j.company_id ${whereSql}`, params))?.n ?? 0,
  )
  const rows = await sql.all(
    `SELECT ${LIST_COLS} FROM company_jobs j JOIN companies c ON c.id = j.company_id ${whereSql}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, Math.min(opts.limit ?? 100, 500), opts.offset ?? 0],
  )
  return { items: rows.map(toItem), total }
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
    await sql.run('UPDATE company_jobs SET match_score = ?, match_breakdown = ?, matched = ? WHERE id = ?', [
      score,
      JSON.stringify(breakdown),
      matched,
      Number(r.id),
    ])
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
