/**
 * Durable task queue in the app database (works on SQLite and Postgres).
 *
 * The web process enqueues; the worker process claims tasks atomically by lane:
 *   browser — Playwright work, strictly one at a time (one live browser)
 *   llm     — Claude calls, one at a time (Pro usage limits)
 *   default — scans, JD fetches, rescoring; a few in parallel
 * Failed tasks retry with backoff; tasks stuck in `running` (worker died) are
 * reclaimed after LOCK_TIMEOUT_MS.
 */
import { parseJson, sql } from '@/lib/server/db'

export type Lane = 'browser' | 'llm' | 'default'

export interface Task<P = Record<string, unknown>> {
  id: number
  type: string
  lane: Lane
  payload: P
  status: 'queued' | 'running' | 'done' | 'failed'
  attempts: number
  max_attempts: number
  last_error: string | null
  result: unknown
  created_at: string
  updated_at: string
}

export const LOCK_TIMEOUT_MS = 10 * 60_000

export function laneFor(type: string): Lane {
  if (type.startsWith('apply.') || type === 'browser.open_profile') return 'browser'
  if (type.startsWith('llm.') || type === 'resume.tailor') return 'llm'
  return 'default'
}

function hydrate(r: Record<string, unknown>): Task {
  return {
    id: Number(r.id),
    type: String(r.type),
    lane: String(r.lane) as Lane,
    payload: parseJson<Record<string, unknown>>(r.payload) ?? {},
    status: String(r.status) as Task['status'],
    attempts: Number(r.attempts ?? 0),
    max_attempts: Number(r.max_attempts ?? 3),
    last_error: (r.last_error as string) ?? null,
    result: parseJson(r.result),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }
}

export interface EnqueueOpts {
  lane?: Lane
  /** If a queued/running task with this key exists, return it instead of adding another. */
  dedupeKey?: string
  delayMs?: number
  maxAttempts?: number
}

export async function enqueue(
  type: string,
  payload: Record<string, unknown> = {},
  opts: EnqueueOpts = {},
): Promise<number> {
  if (opts.dedupeKey) {
    const existing = await sql.one(
      "SELECT id FROM tasks WHERE dedupe_key = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1",
      [opts.dedupeKey],
    )
    if (existing) return Number(existing.id)
  }
  const now = new Date()
  return sql.insert(
    'INSERT INTO tasks (type, lane, payload, status, dedupe_key, run_after, attempts, max_attempts, created_at, updated_at) ' +
      "VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?)",
    [
      type,
      opts.lane ?? laneFor(type),
      JSON.stringify(payload),
      opts.dedupeKey ?? null,
      new Date(now.getTime() + (opts.delayMs ?? 0)).toISOString(),
      opts.maxAttempts ?? (laneFor(type) === 'browser' ? 1 : 3),
      now.toISOString(),
      now.toISOString(),
    ],
  )
}

/** Atomically claim the oldest runnable task in a lane. */
export async function claim(lane: Lane, workerId: string): Promise<Task | null> {
  const now = new Date().toISOString()
  const pick =
    "SELECT id FROM tasks WHERE status = 'queued' AND lane = ? AND run_after <= ? ORDER BY id LIMIT 1" +
    (sql.IS_PG ? ' FOR UPDATE SKIP LOCKED' : '')
  const row = await sql.one(
    `UPDATE tasks SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ?
     WHERE id = (${pick}) AND status = 'queued' RETURNING *`,
    [workerId, now, now, lane, now],
  )
  return row ? hydrate(row) : null
}

export async function complete(id: number, result: unknown = null): Promise<void> {
  await sql.run(
    "UPDATE tasks SET status = 'done', result = ?, last_error = NULL, locked_by = NULL, updated_at = ? WHERE id = ?",
    [result == null ? null : JSON.stringify(result), new Date().toISOString(), id],
  )
}

/** Record a failure: retry with exponential backoff, or mark failed after max attempts. */
export async function fail(task: Task, error: string, opts: { retry?: boolean } = {}): Promise<'retry' | 'failed'> {
  const now = Date.now()
  const retry = opts.retry !== false && task.attempts < task.max_attempts
  if (retry) {
    const backoff = Math.min(30 * 60_000, 15_000 * 2 ** (task.attempts - 1))
    await sql.run(
      "UPDATE tasks SET status = 'queued', last_error = ?, locked_by = NULL, run_after = ?, updated_at = ? WHERE id = ?",
      [error.slice(0, 2000), new Date(now + backoff).toISOString(), new Date(now).toISOString(), task.id],
    )
    return 'retry'
  }
  await sql.run(
    "UPDATE tasks SET status = 'failed', last_error = ?, locked_by = NULL, updated_at = ? WHERE id = ?",
    [error.slice(0, 2000), new Date(now).toISOString(), task.id],
  )
  return 'failed'
}

/** Put tasks whose worker died back in the queue. */
export async function reclaimStuck(timeoutMs = LOCK_TIMEOUT_MS): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs).toISOString()
  return sql.run(
    "UPDATE tasks SET status = 'queued', locked_by = NULL, updated_at = ? WHERE status = 'running' AND locked_at < ?",
    [new Date().toISOString(), cutoff],
  )
}

/** On worker start: anything this machine's previous worker left running is orphaned. */
export async function requeueOrphans(): Promise<number> {
  return sql.run(
    "UPDATE tasks SET status = CASE WHEN lane = 'browser' THEN 'failed' ELSE 'queued' END, " +
      "last_error = CASE WHEN lane = 'browser' THEN 'Worker restarted during this step' ELSE last_error END, " +
      "locked_by = NULL, updated_at = ? WHERE status = 'running'",
    [new Date().toISOString()],
  )
}

export async function getTask(id: number): Promise<Task | null> {
  const r = await sql.one('SELECT * FROM tasks WHERE id = ?', [id])
  return r ? hydrate(r) : null
}

export async function queueStats(): Promise<Record<string, number>> {
  const rows = await sql.all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status')
  return Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]))
}

/** Remove finished tasks older than `days` so the table stays small. */
export async function prune(days = 7): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  return sql.run("DELETE FROM tasks WHERE status IN ('done', 'failed') AND updated_at < ?", [cutoff])
}

// ---------- small key/value store (worker heartbeat etc.) ----------

export async function kvSet(k: string, v: unknown): Promise<void> {
  const now = new Date().toISOString()
  const val = JSON.stringify(v)
  if (sql.IS_PG) {
    await sql.run(
      'INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at',
      [k, val, now],
    )
  } else {
    await sql.run('INSERT OR REPLACE INTO kv (k, v, updated_at) VALUES (?, ?, ?)', [k, val, now])
  }
}

export async function kvGet<T>(k: string): Promise<{ value: T | null; updated_at: string } | null> {
  const r = await sql.one('SELECT v, updated_at FROM kv WHERE k = ?', [k])
  return r ? { value: parseJson<T>(r.v), updated_at: String(r.updated_at) } : null
}
