import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

const PRIORITIES = ['high', 'normal', 'low']

/** Change a company's priority (part of the relevance score). */
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  if (!(await db.getCompany(id))) throw new HttpError(404, 'Company not found')
  const { priority } = await readJson<{ priority?: string }>(req)
  if (!priority || !PRIORITIES.includes(priority)) throw new HttpError(400, 'priority must be high, normal or low')
  const c = await db.updateCompany(id, { priority })
  await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' })
  return json(c)
})

export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  if (!(await db.getCompany(id))) throw new HttpError(404, 'Company not found')
  await db.deleteCompany(id)
  return json({ ok: true })
})
