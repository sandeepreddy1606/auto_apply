/**
 * Storage for applications + companies.
 *
 * Backend is chosen at first use: PostgreSQL when DATABASE_URL is set (e.g. a
 * Neon connection string), otherwise a local SQLite file. Queries are written
 * once with '?' placeholders; a thin layer adapts placeholders, auto-increment
 * ids and case-insensitive matching per backend. JSON columns are stored as TEXT
 * in both so the rest of the app is identical.
 *
 * Unlike the Python version there is no manual reconnect-and-retry loop: pg.Pool
 * evicts dead connections and hands out a fresh one on the next checkout, which
 * is what that loop was emulating around a single long-lived connection.
 */
import type {
  Company,
  CompanyJob,
  CompanyJobsSummary,
  JobState,
  ScanResult,
} from '@/lib/types'

import { tidyCompanyName } from '@/lib/companies/names'

import { DATABASE_URL } from './env'
import { runMigrations } from './migrations'
import { DB_PATH } from './paths'

export const IS_PG = /^postgres(ql)?:\/\//.test(DATABASE_URL)

const log = (...args: unknown[]) => console.log('[autoapply.db]', ...args)

if (IS_PG) {
  log('Storage backend: PostgreSQL')
} else if (DATABASE_URL) {
  console.warn(
    `[autoapply.db] DATABASE_URL is set but is not a postgres:// URL (${DATABASE_URL.slice(0, 12)}…) — ` +
      'falling back to local SQLite. Check your .env.',
  )
} else {
  log(`Storage backend: SQLite (${DB_PATH})`)
}

const PK = IS_PG ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
const LIKE = IS_PG ? 'ILIKE' : 'LIKE'

const SCHEMA_STMTS = [
  `CREATE TABLE IF NOT EXISTS applications (
      id ${PK},
      created_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      channel TEXT,
      raw_text TEXT NOT NULL,
      text_hash TEXT UNIQUE,
      method TEXT NOT NULL DEFAULT 'unknown',
      email_to TEXT,
      form_url TEXT,
      apply_url TEXT,
      job_title TEXT,
      company TEXT,
      location TEXT,
      experience TEXT,
      salary TEXT,
      extra TEXT,
      email_subject TEXT,
      email_body TEXT,
      form_schema TEXT,
      form_answers TEXT,
      status TEXT NOT NULL DEFAULT 'review',
      status_reason TEXT,
      error TEXT,
      applied_at TEXT,
      notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS companies (
      id ${PK},
      name TEXT NOT NULL,
      career_url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_scanned_at TEXT,
      last_status TEXT,
      last_error TEXT,
      jobs_found INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS company_jobs (
      id ${PK},
      company_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT,
      matched INTEGER NOT NULL DEFAULT 0,
      match_reason TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'new',
      UNIQUE(company_id, url)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_company_jobs_company ON company_jobs(company_id)',
]

type Param = string | number | null
type Row = Record<string, unknown>

/** '?' placeholders -> '$1, $2, …' for postgres. */
function translate(sql: string): string {
  if (!IS_PG) return sql
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

interface Backend {
  all(sql: string, params?: Param[]): Promise<Row[]>
  one(sql: string, params?: Param[]): Promise<Row | null>
  run(sql: string, params?: Param[]): Promise<number>
  insert(sql: string, params?: Param[]): Promise<number>
}

interface Driver extends Backend {
  tx<T>(fn: (b: Backend) => Promise<T>): Promise<T>
}

// ---------- postgres ----------

async function makePgDriver(): Promise<Driver> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15_000,
    max: 10,
  })
  // A pooled client dying in the background must not take the process down.
  pool.on('error', (err) => console.warn('[autoapply.db] idle client error:', err.message))

  const wrap = (q: (sql: string, params: Param[]) => Promise<{ rows: Row[]; rowCount: number | null }>): Backend => ({
    async all(sql, params = []) {
      return (await q(translate(sql), params)).rows
    },
    async one(sql, params = []) {
      return (await q(translate(sql), params)).rows[0] ?? null
    },
    async run(sql, params = []) {
      return (await q(translate(sql), params)).rowCount ?? 0
    },
    async insert(sql, params = []) {
      const res = await q(`${translate(sql)} RETURNING id`, params)
      return Number(res.rows[0].id)
    },
  })

  const base = wrap((sql, params) => pool.query(sql, params))

  return {
    ...base,
    async tx<T>(fn: (b: Backend) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(wrap((sql, params) => client.query(sql, params)))
        await client.query('COMMIT')
        return result
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    },
  }
}

// ---------- sqlite ----------

async function makeSqliteDriver(): Promise<Driver> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode=WAL')
  // The web server and the worker process share this file; wait for the other
  // writer's lock instead of failing immediately with SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout=8000')

  const base: Backend = {
    async all(sql, params = []) {
      return db.prepare(sql).all(...(params as never[])) as Row[]
    },
    async one(sql, params = []) {
      return (db.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null
    },
    async run(sql, params = []) {
      return Number(db.prepare(sql).run(...(params as never[])).changes)
    },
    async insert(sql, params = []) {
      return Number(db.prepare(sql).run(...(params as never[])).lastInsertRowid)
    },
  }

  return {
    ...base,
    async tx<T>(fn: (b: Backend) => Promise<T>): Promise<T> {
      db.exec('BEGIN')
      try {
        const result = await fn(base)
        db.exec('COMMIT')
        return result
      } catch (e) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* already rolled back */
        }
        throw e
      }
    },
  }
}

// ---------- lazy singleton ----------
// Next.js can re-evaluate modules across route bundles and on hot reload;
// stashing the driver on globalThis keeps one pool / one sqlite handle.

const GLOBAL_KEY = Symbol.for('autoapply.db.driver')
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Promise<Driver> }

async function initDriver(): Promise<Driver> {
  const driver = IS_PG ? await makePgDriver() : await makeSqliteDriver()
  for (const stmt of SCHEMA_STMTS) await driver.run(stmt)
  // Migration: add apply_url to databases created before it existed.
  if (IS_PG) {
    await driver.run('ALTER TABLE applications ADD COLUMN IF NOT EXISTS apply_url TEXT')
  } else {
    const cols = await driver.all('PRAGMA table_info(applications)')
    if (!cols.some((c) => c.name === 'apply_url')) {
      await driver.run('ALTER TABLE applications ADD COLUMN apply_url TEXT')
    }
  }
  await runMigrations(driver, IS_PG)
  return driver
}

function getDriver(): Promise<Driver> {
  const g = globalThis as GlobalWithDb
  if (!g[GLOBAL_KEY]) {
    // Don't publish a half-initialized driver — a later call must be able to
    // retry schema setup cleanly instead of being stuck on a rejected promise.
    g[GLOBAL_KEY] = initDriver().catch((e) => {
      delete g[GLOBAL_KEY]
      throw e
    })
  }
  return g[GLOBAL_KEY]
}

const all = async (sql: string, params: Param[] = []) => (await getDriver()).all(sql, params)
const one = async (sql: string, params: Param[] = []) => (await getDriver()).one(sql, params)
const run = async (sql: string, params: Param[] = []) => (await getDriver()).run(sql, params)
const insert = async (sql: string, params: Param[] = []) => (await getDriver()).insert(sql, params)
const tx = async <T>(fn: (b: Backend) => Promise<T>) => (await getDriver()).tx(fn)

// ---------- helpers ----------

const nowIso = () => new Date().toISOString()

const toNum = (v: unknown): number => Number(v ?? 0)

// ---------- companies / career-page jobs ----------

export async function addCompany(name: string, careerUrl: string): Promise<Company | null> {
  const id = await insert(
    'INSERT INTO companies (name, career_url, created_at) VALUES (?, ?, ?)',
    [tidyCompanyName(name), careerUrl, nowIso()],
  )
  return getCompany(id)
}

export async function getCompany(companyId: number): Promise<Company | null> {
  return (await one('SELECT * FROM companies WHERE id = ?', [companyId])) as Company | null
}

export async function listCompanies(): Promise<Company[]> {
  const order = IS_PG ? 'lower(c.name)' : 'c.name COLLATE NOCASE'
  const sql = `
    SELECT c.*,
        (SELECT COUNT(DISTINCT lower(j.title)) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.state != 'dismissed') AS active_jobs,
        (SELECT COUNT(DISTINCT lower(j.title)) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.matched = 1 AND j.state != 'dismissed') AS matched_jobs,
        (SELECT COUNT(DISTINCT lower(j.title)) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.matched = 1 AND j.state = 'new') AS new_jobs,
        (SELECT COUNT(*) FROM apply_sessions s JOIN company_jobs j ON j.id = s.job_id
         WHERE j.company_id = c.id AND s.status != 'cancelled') AS applications,
        (SELECT COUNT(*) FROM apply_sessions s JOIN company_jobs j ON j.id = s.job_id
         WHERE j.company_id = c.id AND s.status = 'submitted') AS submitted
    FROM companies c ORDER BY ${order}`
  // Postgres COUNT(*) comes back as a bigint string; normalize so the UI can do arithmetic.
  return (await all(sql)).map((r) => ({
    ...r,
    active_jobs: toNum(r.active_jobs),
    matched_jobs: toNum(r.matched_jobs),
    new_jobs: toNum(r.new_jobs),
    applications: toNum(r.applications),
    submitted: toNum(r.submitted),
    paused: toNum(r.paused),
    fail_count: toNum(r.fail_count),
  })) as Company[]
}

/** Applications (any status but cancelled) started for a company's jobs. */
export async function companyApplicationCount(companyId: number): Promise<number> {
  return toNum(
    (await one(
      "SELECT COUNT(*) AS n FROM apply_sessions s JOIN company_jobs j ON j.id = s.job_id WHERE j.company_id = ? AND s.status != 'cancelled'",
      [companyId],
    ))?.n,
  )
}

export async function updateCompany(
  companyId: number,
  fields: Record<string, unknown>,
): Promise<Company | null> {
  if (Object.keys(fields).length === 0) return getCompany(companyId)
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ')
  await run(`UPDATE companies SET ${sets} WHERE id = ?`, [
    ...(Object.values(fields) as Param[]),
    companyId,
  ])
  return getCompany(companyId)
}

export async function deleteCompany(companyId: number): Promise<void> {
  await tx(async (b) => {
    await b.run('DELETE FROM company_jobs WHERE company_id = ?', [companyId])
    await b.run('DELETE FROM companies WHERE id = ?', [companyId])
  })
}

export interface ScannedJob {
  title: string
  url: string
  location: string | null
  matched: boolean
  match_reason: string | null
  // Career-flow extras (all optional so older callers keep working).
  description_html?: string | null
  description_text?: string | null
  posted_at?: string | null
  ats_job_id?: string | null
  apply_url?: string | null
  match_score?: number | null
  match_breakdown?: string | null
}

export interface SyncResult extends ScanResult {
  new_ids: number[]
  needs_jd_ids: number[]
}

export interface SyncOptions {
  /**
   * The scan returned a search window (Amazon/Google/Microsoft) or possibly a
   * partial list: a job missing from it may still be open. Missing jobs are
   * only closed once they haven't been seen for `staleDays`.
   */
  windowed?: boolean
  staleDays?: number
}

/** Below this share of the previous active count, a scan is treated as partial. */
export const PARTIAL_SCAN_RATIO = 0.3

/**
 * Upsert this scan's jobs; deactivate ones that disappeared from the page.
 * User state (new/seen/dismissed/applied) survives rescans, and a description
 * already fetched is never overwritten with an empty one.
 *
 * Closing is careful: a search window, or a scan that suddenly returns far
 * fewer jobs than last time (site hiccup, rate limit), only closes jobs that
 * haven't been seen for a while instead of everything missing right now.
 */
export async function syncCompanyJobs(
  companyId: number,
  jobs: ScannedJob[],
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const now = nowIso()
  return tx(async (b) => {
    let created = 0
    let matched = 0
    const newIds: number[] = []
    const needsJd: number[] = []
    const seenUrls = new Set<string>()
    for (const j of jobs) {
      seenUrls.add(j.url)
      if (j.matched) matched += 1
      const desc = j.description_html ?? null
      const text = j.description_text ?? null
      const row = await b.one(
        'SELECT id, description_text FROM company_jobs WHERE company_id = ? AND url = ?',
        [companyId, j.url],
      )
      if (row) {
        await b.run(
          'UPDATE company_jobs SET title = ?, location = ?, matched = ?, ' +
            'match_reason = ?, last_seen_at = ?, active = 1, ' +
            'description_html = COALESCE(?, description_html), ' +
            'description_text = COALESCE(?, description_text), ' +
            'jd_fetched_at = CASE WHEN ? IS NULL THEN jd_fetched_at ELSE ? END, ' +
            'posted_at = COALESCE(?, posted_at), ats_job_id = COALESCE(?, ats_job_id), ' +
            'apply_url = COALESCE(?, apply_url), match_score = ?, match_breakdown = ? ' +
            'WHERE id = ?',
          [
            j.title, j.location, j.matched ? 1 : 0, j.match_reason, now,
            desc, text, text, text ? now : null,
            j.posted_at ?? null, j.ats_job_id ?? null, j.apply_url ?? null,
            j.match_score ?? null, j.match_breakdown ?? null, Number(row.id),
          ],
        )
        if (!text && !row.description_text) needsJd.push(Number(row.id))
      } else {
        const id = await b.insert(
          'INSERT INTO company_jobs (company_id, url, title, location, matched, ' +
            'match_reason, first_seen_at, last_seen_at, active, state, description_html, ' +
            'description_text, jd_fetched_at, posted_at, ats_job_id, apply_url, match_score, ' +
            "match_breakdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'new', ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            companyId, j.url, j.title, j.location, j.matched ? 1 : 0, j.match_reason, now, now,
            desc, text, text ? now : null, j.posted_at ?? null, j.ats_job_id ?? null,
            j.apply_url ?? null, j.match_score ?? null, j.match_breakdown ?? null,
          ],
        )
        created += 1
        newIds.push(id)
        if (!text) needsJd.push(id)
      }
    }
    const rows = await b.all(
      'SELECT id, url, last_seen_at FROM company_jobs WHERE company_id = ? AND active = 1',
      [companyId],
    )
    const missing = rows.filter((r) => !seenUrls.has(String(r.url)))
    const partial = rows.length >= 10 && jobs.length < rows.length * PARTIAL_SCAN_RATIO
    const cautious = opts.windowed || partial
    const staleBefore = Date.now() - (opts.staleDays ?? 14) * 86_400_000
    const gone = missing
      .filter((r) => !cautious || Date.parse(String(r.last_seen_at)) < staleBefore)
      .map((r) => Number(r.id))
    for (const g of gone) {
      await b.run('UPDATE company_jobs SET active = 0 WHERE id = ?', [g])
    }
    return {
      found: jobs.length,
      new: created,
      matched,
      gone: gone.length,
      new_ids: newIds,
      needs_jd_ids: needsJd,
    }
  })
}

export async function listCompanyJobs(opts: {
  view?: string
  companyId?: number | null
  q?: string | null
  limit?: number
} = {}): Promise<CompanyJob[]> {
  const { view = 'matched', companyId, q, limit = 500 } = opts
  let sql =
    'SELECT j.*, c.name AS company_name FROM company_jobs j ' +
    'JOIN companies c ON c.id = j.company_id'
  const where: string[] = []
  const params: Param[] = []
  if (view === 'everything') {
    // Active postings, plus any the user has acted on (applied/dismissed) so
    // that history survives a rescan that deactivates a vanished posting.
    where.push("(j.active = 1 OR j.state IN ('applied', 'dismissed'))")
  } else if (view === 'dismissed') {
    where.push("j.state = 'dismissed'")
  } else if (view === 'all') {
    where.push("j.active = 1 AND j.state != 'dismissed'")
  } else {
    // matched (default)
    where.push("j.active = 1 AND j.matched = 1 AND j.state != 'dismissed'")
  }
  if (companyId) {
    where.push('j.company_id = ?')
    params.push(companyId)
  }
  if (q) {
    where.push(`(j.title ${LIKE} ? OR c.name ${LIKE} ? OR j.location ${LIKE} ?)`)
    const like = `%${q}%`
    params.push(like, like, like)
  }
  sql += ` WHERE ${where.join(' AND ')}`
  // Postgres won't order by a bare boolean expression the way SQLite does, so
  // the "new first" key is written as a CASE that both engines accept.
  sql +=
    " ORDER BY CASE WHEN j.state = 'new' THEN 0 ELSE 1 END, j.first_seen_at DESC, j.id DESC LIMIT ?"
  params.push(limit)
  return (await all(sql, params)).map((r) => ({
    ...r,
    matched: toNum(r.matched),
    active: toNum(r.active),
  })) as CompanyJob[]
}

/** One job added by hand (a link you found), outside any scan. Returns its id. */
export async function insertCompanyJob(fields: { companyId: number; url: string; title: string; location: string | null; postedAt?: string | null }): Promise<number> {
  const now = nowIso()
  return insert(
    'INSERT INTO company_jobs (company_id, url, title, location, matched, match_reason, first_seen_at, last_seen_at, active, state, posted_at) ' +
      "VALUES (?, ?, ?, ?, 0, NULL, ?, ?, 1, 'new', ?)",
    [fields.companyId, fields.url, fields.title.slice(0, 200), fields.location, now, now, fields.postedAt ?? null],
  )
}

export async function findCompanyJobByUrl(url: string): Promise<{ id: number } | null> {
  const r = await one('SELECT id FROM company_jobs WHERE url = ? ORDER BY id DESC LIMIT 1', [url])
  return r ? { id: Number(r.id) } : null
}

export async function getCompanyJob(jobId: number): Promise<CompanyJob | null> {
  return (await one('SELECT * FROM company_jobs WHERE id = ?', [jobId])) as CompanyJob | null
}

export async function setCompanyJobState(
  jobId: number,
  state: JobState,
): Promise<CompanyJob | null> {
  await run('UPDATE company_jobs SET state = ? WHERE id = ?', [state, jobId])
  return getCompanyJob(jobId)
}

export async function markCompanyJobsSeen(): Promise<number> {
  return run("UPDATE company_jobs SET state = 'seen' WHERE state = 'new'")
}

/** One posting = one company + title; the same job listed in several cities counts once (as in the Jobs list). */
const POSTING = "CAST(company_id AS TEXT) || '|' || lower(title)"

export async function companyJobsSummary(): Promise<CompanyJobsSummary> {
  const newMatched = toNum(
    (
      await one(
        `SELECT COUNT(DISTINCT ${POSTING}) AS n FROM company_jobs WHERE active = 1 AND matched = 1 AND state = 'new'`,
      )
    )?.n,
  )
  const totalMatched = toNum(
    (
      await one(
        `SELECT COUNT(DISTINCT ${POSTING}) AS n FROM company_jobs WHERE active = 1 AND matched = 1 AND state != 'dismissed'`,
      )
    )?.n,
  )
  const companies = toNum((await one('SELECT COUNT(*) AS n FROM companies'))?.n)
  return { new_matched: newMatched, total_matched: totalMatched, companies }
}

// ---------- shared access for the career-flow modules ----------
// The newer modules (jobs, resume, apply, tasks) keep their own queries next
// to their logic; they reach the same lazily-initialised driver through this.

export const sql = { all, one, run, insert, tx, nowIso, LIKE, IS_PG }
export type SqlParam = Param
export type SqlRow = Row

/** Parse a JSON TEXT column, tolerating null and malformed values. */
export function parseJson<T>(v: unknown): T | null {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return v as T
  try {
    return JSON.parse(v) as T
  } catch {
    return null
  }
}
