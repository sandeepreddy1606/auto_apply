import { addEvent } from '@/lib/apply/sessions'
import { createVersion, getVersion, updateVersion } from '@/lib/resume/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ vid: string }> }

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const v = await getVersion(intParam((await ctx.params).vid))
  if (!v) throw new HttpError(404, 'Version not found')
  return json(v)
})

/**
 * Save your LaTeX edit. A draft you already edited is updated in place;
 * anything else (base copy, AI version, a locked one) gets a new child version,
 * so every generated/sent version stays intact.
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const v = await getVersion(intParam((await ctx.params).vid))
  if (!v) throw new HttpError(404, 'Version not found')
  if (v.status === 'generating') throw new HttpError(409, 'Wait for generation to finish.')
  const { latex } = await readJson<{ latex?: string }>(req)
  if (typeof latex !== 'string' || !latex.includes('\\begin{document}')) {
    throw new HttpError(400, 'That doesn’t look like a complete LaTeX document.')
  }
  if (latex.length > 400_000) throw new HttpError(413, 'Document too large.')
  if (latex === v.latex) return json(v)
  if (v.generated_by === 'user' && v.status === 'draft') {
    await updateVersion(v.id, { latex, compile_log: null, ats_report: null, page_count: null })
    return json(await getVersion(v.id))
  }
  const id = await createVersion({ base_id: v.base_id, parent_id: v.id, job_id: v.job_id, session_id: v.session_id, latex, generated_by: 'user', status: 'draft' })
  if (v.session_id) await addEvent(v.session_id, 'resume.edited', 'user', { version_id: id, parent_id: v.id })
  return json(await getVersion(id))
})
