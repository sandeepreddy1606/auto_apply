import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  if (!(await db.getCompany(id))) throw new HttpError(404, 'Company not found')
  await db.deleteCompany(id)
  return json({ ok: true })
})
