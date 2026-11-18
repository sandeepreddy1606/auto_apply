import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json, pick, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Mirrors the old PatchBody model. Also a SQL-safety boundary: these keys are
// interpolated as column names by db.updateApplication.
const PATCHABLE = [
  'method', 'email_to', 'form_url', 'apply_url', 'job_title', 'company',
  'location', 'experience', 'salary', 'email_subject', 'email_body',
  'form_answers', 'status', 'notes',
] as const

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  const record = await db.getApplication(id)
  if (!record) throw new HttpError(404, 'Application not found')
  return json(record)
})

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  if (!(await db.getApplication(id))) throw new HttpError(404, 'Application not found')
  const fields = pick<Record<string, unknown>>(await readJson(req), PATCHABLE)
  // "I submitted it myself": record when.
  if (fields.status === 'applied') {
    fields.applied_at = new Date().toISOString()
    fields.status_reason = null
  }
  return json(await db.updateApplication(id, fields))
})

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  await db.deleteApplication(id)
  return json({ ok: true })
})
