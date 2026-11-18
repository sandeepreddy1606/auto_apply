import * as store from '@/lib/server/claude-applications'
import { handler, intParam, json, pick, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  return json(store.update(id, pick(await readJson(req), ['status', 'note'] as const)))
})

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  store.remove(intParam((await ctx.params).id))
  return json({ ok: true })
})
