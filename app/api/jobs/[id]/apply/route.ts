import { startSession } from '@/lib/apply/start'
import { handler, intParam, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Start (or reopen) the application session for a job. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  return json(await startSession(intParam((await ctx.params).id)))
})
