import { queueScan } from '@/lib/companies/schedule'
import * as db from '@/lib/server/db'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Queue a scan of every company that isn't paused; the worker runs them. */
export const POST = handler(async () => {
  const companies = (await db.listCompanies()).filter((c) => !c.paused)
  for (const c of companies) await queueScan(c.id)
  return json({ started: companies.length })
})
