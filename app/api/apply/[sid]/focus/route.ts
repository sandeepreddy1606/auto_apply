import { getSession } from '@/lib/apply/sessions'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Bring this application's browser tab to the front (to sign in or solve a CAPTCHA). */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  if (!(await getSession(sid))) throw new HttpError(404, 'Application not found')
  return json({ task_id: await enqueue('apply.focus', { session_id: sid }) })
})
