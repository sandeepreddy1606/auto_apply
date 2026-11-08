import { setupStatus } from '@/lib/setup/checks'
import { handler, json } from '@/lib/server/http'
import { queueStats } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json({ ...(await setupStatus()), queue: await queueStats() }))
