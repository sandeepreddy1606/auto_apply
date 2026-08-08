import * as db from '@/lib/server/db'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: Request) => {
  const days = Number(new URL(req.url).searchParams.get('days') ?? 120)
  return json(await db.activity(Number.isFinite(days) ? days : 120))
})
