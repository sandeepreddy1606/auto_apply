import { getJob } from '@/lib/jobs/store'
import { HttpError, handler, intParam, json } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Re-fetch the job description (runs in the worker). */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  if (!(await getJob(id))) throw new HttpError(404, 'Job not found')
  const task = await enqueue('jobs.fetch_jd', { job_id: id }, { dedupeKey: `jd:${id}` })
  return json({ task_id: task })
})
