import { handler, json } from '@/lib/server/http'
import { manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = handler(async () => json(await manager.connect()))
