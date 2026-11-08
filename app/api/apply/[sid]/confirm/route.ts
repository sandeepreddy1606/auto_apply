import { getSession, setStage, setStatus } from '@/lib/apply/sessions'
import { setJobState } from '@/lib/jobs/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Resolve "did it go through?" after a submit without a detectable confirmation. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  if (s.status !== 'unconfirmed') throw new HttpError(409, 'Nothing to confirm.')
  const { submitted } = await readJson<{ submitted?: boolean }>(req)
  if (submitted) {
    await setStatus(sid, 'submitted', { submitted_at: new Date().toISOString(), error: null }, { type: 'submit.confirmed_by_user', actor: 'user' })
    await setJobState(s.job_id, 'applied')
    await setStage(sid, 'applied')
    await enqueue('apply.cancel', { session_id: sid }) // close the page
  } else {
    await setStatus(sid, 'reviewing', { error: null }, { type: 'submit.not_confirmed', actor: 'user' })
  }
  return json(await getSession(sid))
})
