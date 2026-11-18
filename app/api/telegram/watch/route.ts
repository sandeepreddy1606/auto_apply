import type { WatchedChat } from '@/lib/types'

import { handler, json, readJson } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'
import { manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ chats?: unknown }>(req)
  const chats: WatchedChat[] = (Array.isArray(body.chats) ? body.chats : [])
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({ id: String(c.id), title: String(c.title ?? c.id), kind: c.kind ? String(c.kind) : undefined, username: c.username ? String(c.username) : null }))
  settingsStore.save({ telegram: { ...settingsStore.load().telegram, watched_chats: chats } })
  return json(manager.status())
})
