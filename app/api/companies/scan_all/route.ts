import * as db from '@/lib/server/db'
import { handler, json } from '@/lib/server/http'
import { scanCompany } from '@/lib/server/scanner'
import * as settingsStore from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

/**
 * Kicks the scans off and returns immediately; the UI polls the company rows
 * for results, exactly as it did against the FastAPI background task.
 */
export const POST = handler(async () => {
  const companies = await db.listCompanies()

  void (async () => {
    for (const c of companies) {
      try {
        await scanCompany(c, settingsStore.load())
      } catch {
        console.warn(`[autoapply.scanloop] Manual scan failed for ${c.name}`)
      }
    }
  })()

  return json({ started: companies.length })
})
