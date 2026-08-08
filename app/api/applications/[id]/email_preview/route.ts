import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import * as service from '@/lib/server/service'

export const dynamic = 'force-dynamic'

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  const record = await db.getApplication(id)
  if (!record) throw new HttpError(404, 'Application not found')
  return json(service.emailPreview(record))
})
