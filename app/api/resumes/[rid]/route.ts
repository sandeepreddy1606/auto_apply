import { HttpError, handler, json, pick, readJson } from '@/lib/server/http'
import * as resumeStore from '@/lib/server/resumes'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ rid: string }> }

const UPDATABLE = ['name', 'keywords', 'is_default'] as const

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const { rid } = await ctx.params
  const fields = pick(await readJson(req), UPDATABLE)
  try {
    return json(resumeStore.updateResume(rid, fields))
  } catch (e) {
    throw new HttpError(404, (e as Error).message)
  }
})

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  resumeStore.deleteResume((await ctx.params).rid)
  return json({ ok: true })
})
