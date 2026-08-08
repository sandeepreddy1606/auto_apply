import { HttpError, handler, json } from '@/lib/server/http'
import { manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = handler(async () => {
  try {
    return json(await manager.listChats())
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
})
