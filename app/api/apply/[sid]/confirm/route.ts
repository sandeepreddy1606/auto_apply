import { getSession, setStage, setStatus } from '@/lib/apply/sessions'
import { setJobState } from '@/lib/jobs/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Where "I submitted it myself in the browser window" is accepted. */
const SELF_SUBMIT_FROM = ['resume_ready', 'reviewing', 'needs_input', 'blocked', 'failed']

/**
 * Resolve "did it go through?" after a submit without a detectable
 * confirmation — or record that you finished the form yourself (sites the
 * automation can't complete: sign-in flows, unusual widgets, CAPTCHAs).
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  const { submitted, self } = await readJson<{ submitted?: boolean; self?: boolean }>(req)
  const selfSubmit = self === true && SELF_SUBMIT_FROM.includes(s.status)
  if (s.status !== 'unconfirmed' && !selfSubmit) throw new HttpError(409, 'Nothing to confirm.')
  if (submitted || selfSubmit) {
    await setStatus(sid, 'submitted', { submitted_at: new Date().toISOString(), error: null }, {
      type: selfSubmit ? 'submit.self_reported' : 'submit.confirmed_by_user',
      actor: 'user',
    })
    await setJobState(s.job_id, 'applied')
    await setStage(sid, 'applied')
    await enqueue('apply.cancel', { session_id: sid }) // close the page
  } else {
    await setStatus(sid, 'reviewing', { error: null }, { type: 'submit.not_confirmed', actor: 'user' })
  }
  return json(await getSession(sid))
})
