import { getSession, addEvent } from '@/lib/apply/sessions'
import { createVersion, getVersion } from '@/lib/resume/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Start from a resume you sent to a similar job (copies it as a new draft here). */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  const { version_id } = await readJson<{ version_id?: number }>(req)
  const src = version_id ? await getVersion(Number(version_id)) : null
  if (!src || src.status !== 'locked') throw new HttpError(400, 'Only resumes you sent before can be reused.')
  const vid = await createVersion({ base_id: src.base_id, parent_id: src.id, job_id: s.job_id, session_id: sid, latex: src.latex, generated_by: 'user', status: 'draft', hint: `Reused from version ${src.id}` })
  await addEvent(sid, 'resume.reused', 'user', { from: src.id, version_id: vid })
  return json({ version_id: vid })
})
