import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import { ScanError, scanCompany } from '@/lib/server/scanner'
import * as settingsStore from '@/lib/server/settings'

export const dynamic = 'force-dynamic'
// A cold career page can take a while; give the scan room before the platform
// kills the request.
export const maxDuration = 60

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  const company = await db.getCompany(id)
  if (!company) throw new HttpError(404, 'Company not found')
  try {
    const result = await scanCompany(company, settingsStore.load())
    return json({ company: await db.getCompany(id), result })
  } catch (e) {
    if (e instanceof ScanError) throw new HttpError(400, e.message)
    throw e
  }
})
