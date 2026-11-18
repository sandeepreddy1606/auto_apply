import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Bring this post's Google Form to the front in the automation browser (or reopen it). */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  if (!(await db.getApplication(id))) throw new HttpError(404, 'Post not found')
  return json({ task_id: await enqueue('apply.gform_focus', { application_id: id }) })
})
