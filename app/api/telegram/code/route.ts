import { handler, json, readJson } from '@/lib/server/http'
import { manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ code?: string }>(req)
  return json(await manager.submitCode(body.code || ''))
})
