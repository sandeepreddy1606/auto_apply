import { HttpError, handler, json } from '@/lib/server/http'
import { manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Your groups and channels; ?q= narrows by name, @username or t.me link. */
export const GET = handler(async (req: Request) => {
  try {
    return json(await manager.listChats(new URL(req.url).searchParams.get('q') || ''))
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
})
