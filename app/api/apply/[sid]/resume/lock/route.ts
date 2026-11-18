import { canLock } from '@/lib/apply/start'
import { assertCanChangeResume, lockVersion } from '@/lib/apply/relock'
import { getSession } from '@/lib/apply/sessions'
import { getVersion } from '@/lib/resume/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** "Use this resume": lock a compiled version to the application. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  assertCanChangeResume(s)
  const { version_id } = await readJson<{ version_id?: number }>(req)
  const v = version_id ? await getVersion(Number(version_id)) : null
  if (!v || v.session_id !== sid) throw new HttpError(400, 'Pick a version of this application’s resume.')
  const gate = await canLock(v.id)
  if (!gate.ok) throw new HttpError(409, gate.reason ?? 'Not ready')
  return json(await lockVersion(s, v.id))
})
