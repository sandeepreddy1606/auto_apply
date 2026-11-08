import { deleteBase, getBase, historyCount, renameBase, setDefaultBase, undoBase, updateBaseLatex } from '@/lib/resume/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  const b = await getBase(id)
  if (!b) throw new HttpError(404, 'Base resume not found')
  return json({ ...b, history: await historyCount(id) })
})

/** Edit the base (LaTeX and/or name), make it default, or undo the last change. */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  if (!(await getBase(id))) throw new HttpError(404, 'Base resume not found')
  const body = await readJson<{ latex?: string; name?: string; make_default?: boolean; undo?: boolean }>(req)
  if (body.undo) {
    const r = await undoBase(id)
    if (!r.ok) throw new HttpError(409, 'Nothing to undo.')
  }
  if (typeof body.latex === 'string') {
    if (!body.latex.includes('\\begin{document}')) throw new HttpError(400, 'That doesn’t look like a complete LaTeX document.')
    await updateBaseLatex(id, body.latex, 'Edited in Settings')
  }
  if (typeof body.name === 'string' && body.name.trim()) await renameBase(id, body.name.trim())
  if (body.make_default) await setDefaultBase(id)
  await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' })
  return json({ ...(await getBase(id))!, history: await historyCount(id) })
})

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  await deleteBase(id)
  return json({ ok: true })
})
