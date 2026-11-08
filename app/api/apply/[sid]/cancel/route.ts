import { getSession, setStatus } from '@/lib/apply/sessions'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  if (s.status === 'submitted') throw new HttpError(409, 'Already submitted — change its stage instead.')
  if (s.status === 'submitting') throw new HttpError(409, 'Submitting right now — wait for the result.')
  await setStatus(sid, 'cancelled', {}, { type: 'session.cancelled', actor: 'user' })
  await enqueue('apply.cancel', { session_id: sid })
  return json(await getSession(sid))
})
