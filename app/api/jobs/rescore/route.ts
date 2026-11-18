import { handler, json } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Re-score every job against your current preferences and resume (local, no scanning). */
export const POST = handler(async () => json({ task_id: await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' }) }))
