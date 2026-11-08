import { getJob, setJobState } from '@/lib/jobs/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import type { JobState } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const job = await getJob(intParam((await ctx.params).id))
  if (!job) throw new HttpError(404, 'Job not found')
  return json(job)
})

const STATES: JobState[] = ['new', 'seen', 'shortlisted', 'dismissed']

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  const { state } = await readJson<{ state?: JobState }>(req)
  if (!state || !STATES.includes(state)) throw new HttpError(400, `state must be one of ${STATES.join(', ')}`)
  if (!(await getJob(id))) throw new HttpError(404, 'Job not found')
  await setJobState(id, state)
  return json(await getJob(id))
})
