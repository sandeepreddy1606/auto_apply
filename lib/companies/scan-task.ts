/**
 * Worker-only: runs one queued `companies.scan`. Kept apart from schedule.ts so
 * web routes (which only queue scans) never bundle the scanner and its
 * headless-browser fallback.
 */
import * as db from '@/lib/server/db'
import { sql } from '@/lib/server/db'
import * as settingsStore from '@/lib/server/settings'

import { backoffMs, intervalMinutes } from './schedule'

const MIN = 60_000

/** Worker task `companies.scan`. Never throws: the outcome is stored on the company. */
export async function runScanTask(companyId: number): Promise<Record<string, unknown>> {
  const company = await db.getCompany(companyId)
  if (!company) return { skipped: 'company deleted' }
  await sql.run("UPDATE companies SET scan_state = 'scanning' WHERE id = ?", [companyId])
  const { scanCompany, ScanError } = await import('@/lib/server/scanner')
  const every = intervalMinutes()
  try {
    const result = await scanCompany(company, settingsStore.load())
    await sql.run('UPDATE companies SET fail_count = 0, next_scan_at = ?, scan_state = NULL WHERE id = ?', [
      new Date(Date.now() + every * MIN).toISOString(),
      companyId,
    ])
    return { ...result }
  } catch (e) {
    const msg = (e as Error).message
    const fails = Number((company as unknown as { fail_count?: number }).fail_count ?? 0) + 1
    const rateLimited = /slow down|too many requests|429/i.test(msg)
    const wait = backoffMs(every, fails, rateLimited)
    await sql.run('UPDATE companies SET fail_count = ?, next_scan_at = ?, scan_state = NULL WHERE id = ?', [
      fails,
      new Date(Date.now() + wait).toISOString(),
      companyId,
    ])
    if (!(e instanceof ScanError)) console.error(`[autoapply.scan] ${company.name} crashed:`, e)
    return { error: msg, retry_in_min: Math.round(wait / MIN) }
  }
}

