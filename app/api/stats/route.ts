import * as db from '@/lib/server/db'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json(await db.stats()))
