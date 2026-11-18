import { handler, json } from '@/lib/server/http'
import { chatSyncs, manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'

/** Connection state, watched groups, and when each group was last read. */
export const GET = handler(async () => json({ ...manager.status(), syncs: await chatSyncs().catch(() => ({})) }))
