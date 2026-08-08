import { handler, json } from '@/lib/server/http'
import { DEFAULTS } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json(DEFAULTS))
