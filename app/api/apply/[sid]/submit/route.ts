import { canSubmit } from '@/lib/apply/start'
import { getSession } from '@/lib/apply/sessions'
import { lintBase, hasBlockingIssues } from '@/lib/resume/lint'
import { getDefaultBase, getDismissed } from '@/lib/resume/store'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Click the real submit button. Always a deliberate user action. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  const gate = await canSubmit(s)
  if (!gate.ok) throw new HttpError(409, gate.reason ?? 'Not ready to submit')
  const base = await getDefaultBase()
  if (base && hasBlockingIssues(lintBase(base.latex, settingsStore.load().profile, await getDismissed(base.id)))) {
    throw new HttpError(409, 'Your base resume still has blocking issues (Settings → Resume → Issues).')
  }
  const task = await enqueue('apply.submit', { session_id: sid }, { dedupeKey: `submit:${sid}` })
  return json({ task_id: task })
})
