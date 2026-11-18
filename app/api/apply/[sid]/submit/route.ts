import { canSubmit } from '@/lib/apply/start'
import { getSession } from '@/lib/apply/sessions'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/**
 * Click the real submit button. Always a deliberate user action. Every check
 * lives in canSubmit, so the button shows the same reason the server would give.
 * (Resume problems are checked when the resume is locked, not here.)
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  const gate = await canSubmit(s)
  if (!gate.ok) throw new HttpError(409, gate.reason ?? 'Not ready to submit')
  const task = await enqueue('apply.submit', { session_id: sid }, { dedupeKey: `submit:${sid}` })
  return json({ task_id: task })
})
