import { queueScan } from '@/lib/companies/schedule'
import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * "Scan now": queued for the worker (never two scans of one company at once,
 * never a request that times out on a slow careers site). The page polls the
 * company's scan_state for progress and the result.
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  if (!(await db.getCompany(id))) throw new HttpError(404, 'Company not found')
  const task_id = await queueScan(id)
  return json({ queued: true, task_id, company: await db.getCompany(id) })
})
