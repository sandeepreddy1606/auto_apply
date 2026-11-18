/**
 * Career-page scanning, one path for everything: "Scan now", "Scan all", a
 * newly added company and the background schedule all queue a
 * `companies.scan` task, which the worker runs. So scans never run twice at
 * once, never block a web request, and share one place for pacing.
 *
 * Scheduling is per company: each one is due `interval` after its last scan,
 * so restarting the app doesn't rescan everything. Failures back off
 * (interval × 2^failures, at least an hour after "too many requests", at most
 * a day) and reset after a good scan. Paused companies are only scanned when
 * you ask.
 */
import * as db from '@/lib/server/db'
import { sql } from '@/lib/server/db'
import * as settingsStore from '@/lib/server/settings'
import { enqueue } from '@/lib/tasks/queue'

const MIN = 60_000
const DAY = 24 * 60 * MIN

export function intervalMinutes(): number {
  return Math.max(15, Number(settingsStore.load().companies?.scan_interval_minutes) || 180)
}

/** When to try again after `failCount` failures in a row. */
export function backoffMs(intervalMin: number, failCount: number, rateLimited: boolean): number {
  const base = intervalMin * MIN * 2 ** Math.max(0, failCount - 1)
  return Math.min(DAY, Math.max(base, rateLimited ? 60 * MIN : 0))
}

/** Queue a scan for one company (deduplicated). Returns the task id. */
export async function queueScan(companyId: number): Promise<number> {
  const task = await enqueue('companies.scan', { company_id: companyId }, { dedupeKey: `scan:${companyId}`, maxAttempts: 1 })
  await sql.run("UPDATE companies SET scan_state = 'queued' WHERE id = ? AND (scan_state IS NULL OR scan_state != 'scanning')", [companyId])
  return task
}

/** A scan_state left behind by a worker that stopped mid-scan. */
async function clearStaleStates(): Promise<void> {
  const rows = await sql.all('SELECT id FROM companies WHERE scan_state IS NOT NULL')
  for (const r of rows) {
    const live = await sql.one("SELECT id FROM tasks WHERE dedupe_key = ? AND status IN ('queued', 'running') LIMIT 1", [`scan:${Number(r.id)}`])
    if (!live) await sql.run('UPDATE companies SET scan_state = NULL WHERE id = ?', [Number(r.id)])
  }
}

/** Queue every company whose scan is due. Called every few minutes by the web server. */
export async function queueDueScans(now = Date.now()): Promise<number[]> {
  await clearStaleStates()
  if (settingsStore.load().companies?.auto_scan === false) return []
  const every = intervalMinutes() * MIN
  const rows = await sql.all('SELECT id, last_scanned_at, next_scan_at FROM companies WHERE COALESCE(paused, 0) = 0 AND scan_state IS NULL')
  const due: number[] = []
  for (const r of rows) {
    const next = r.next_scan_at ? Date.parse(String(r.next_scan_at)) : r.last_scanned_at ? Date.parse(String(r.last_scanned_at)) + every : 0
    if (next <= now) due.push(Number(r.id))
  }
  for (const id of due) await queueScan(id)
  return due
}

/** Big employers are searched with your roles/locations: when those change, search again. */
export async function queueSearchSites(): Promise<number> {
  const { detectBigTech } = await import('@/lib/jobs/bigtech')
  const companies = await db.listCompanies()
  let n = 0
  for (const c of companies) {
    if ((c as unknown as { paused?: number }).paused) continue
    if (detectBigTech(c.career_url)) {
      await queueScan(c.id)
      n++
    }
  }
  return n
}

