import * as store from '@/lib/server/claude-applications'
import { handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Newest first. */
export const GET = handler(async () =>
  json([...store.list()].sort((a, b) => Date.parse(b.applied_at) - Date.parse(a.applied_at) || b.id - a.id)),
)

export const POST = handler(async (req: Request) => json(store.add(await readJson(req)), 201))
