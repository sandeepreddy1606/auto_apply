import { canFill } from '@/lib/apply/start'
import { addEvent, getSession } from '@/lib/apply/sessions'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Open the application form in the automation browser and fill it. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  const gate = await canFill(s)
  if (!gate.ok) throw new HttpError(409, gate.reason ?? 'Not ready to fill')
  const task = await enqueue('apply.fill', { session_id: sid }, { dedupeKey: `fill:${sid}` })
  await addEvent(sid, 'fill.queued', 'user', { task_id: task })
  return json({ task_id: task })
})
