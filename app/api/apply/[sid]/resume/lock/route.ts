import { canLock } from '@/lib/apply/start'
import { getSession, setStatus } from '@/lib/apply/sessions'
import { getVersion, updateVersion } from '@/lib/resume/store'
import { sql } from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** "Use this resume": lock a compiled version to the application. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  const { version_id } = await readJson<{ version_id?: number }>(req)
  const v = version_id ? await getVersion(Number(version_id)) : null
  if (!v || v.session_id !== sid) throw new HttpError(400, 'Pick a version of this application’s resume.')
  const gate = await canLock(v.id)
  if (!gate.ok) throw new HttpError(409, gate.reason ?? 'Not ready')
  if (['filling', 'submitting', 'submitted', 'cancelled'].includes(s.status)) {
    throw new HttpError(409, `Can't change the resume while ${s.status.replace('_', ' ')}.`)
  }
  // Exactly one locked version per application.
  await sql.run("UPDATE resume_versions SET status = 'draft' WHERE session_id = ? AND status = 'locked'", [sid])
  await updateVersion(v.id, { status: 'locked' })
  const next = await setStatus(sid, 'resume_ready', { resume_version_id: v.id }, { type: 'resume.locked', actor: 'user', data: { version_id: v.id } })
  return json(next)
})
