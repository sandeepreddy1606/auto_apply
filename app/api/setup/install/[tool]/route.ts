import { INSTALLERS } from '@/lib/setup/installers'
import { HttpError, handler, json } from '@/lib/server/http'
import { enqueue, kvSet } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Run one whitelisted installer in the worker; the Setup page polls its log. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ tool: string }> }) => {
  const tool = (await ctx.params).tool
  if (!Object.hasOwn(INSTALLERS, tool)) throw new HttpError(404, 'Unknown installer')
  await kvSet(`install:${tool}`, { running: true, log: 'Queued…\n' })
  const task = await enqueue('setup.install', { tool }, { dedupeKey: `install:${tool}`, maxAttempts: 1 })
  return json({ task_id: task })
})
