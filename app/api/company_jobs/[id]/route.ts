import type { JobState } from '@/lib/types'

import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

const STATES: readonly JobState[] = ['new', 'seen', 'dismissed', 'applied']

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  const body = await readJson<{ state?: string }>(req)
  const state = body.state as JobState
  if (!STATES.includes(state)) {
    throw new HttpError(400, 'state must be new, seen, dismissed or applied')
  }
  if (!(await db.getCompanyJob(id))) throw new HttpError(404, 'Job not found')
  return json(await db.setCompanyJobState(id, state))
})
