import { handler, json } from '@/lib/server/http'
import { manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json(manager.status()))
