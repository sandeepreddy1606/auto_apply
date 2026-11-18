import { HttpError, handler, json, readJson } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'
import { chatSyncs, manager } from '@/lib/server/telegram'
import type { WatchedChat } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Watch a group you're in: its job posts from the last `days` days are read
 * now (oldest first), and new posts arrive as they're posted.
 */
export const POST = handler(async (req: Request) => {
  const body = await readJson<{ id?: string; title?: string; kind?: string; username?: string | null; days?: number }>(req)
  const id = String(body.id || '').trim()
  if (!id) throw new HttpError(400, 'Pick a group first.')
  const cfg = settingsStore.load().telegram
  const watched = cfg.watched_chats || []
  if (!watched.some((c) => String(c.id) === id)) {
    const chat: WatchedChat = { id, title: String(body.title || id).slice(0, 200), kind: body.kind, username: body.username ?? null }
    settingsStore.save({ telegram: { ...cfg, watched_chats: [...watched, chat] } })
  }
  const days = Number.isFinite(Number(body.days)) ? Math.min(Math.max(Number(body.days), 0), 30) : cfg.history_days
  let fetched = { found: 0, created: 0 }
  let error: string | null = null
  if (days > 0) {
    try {
      fetched = await manager.fetchHistory(id, { days })
    } catch (e) {
      error = (e as Error).message
    }
  }
  return json({ status: manager.status(), syncs: await chatSyncs(), fetched, error })
})

/** Stop watching a group (its posts already in the inbox stay). */
export const DELETE = handler(async (req: Request) => {
  const id = new URL(req.url).searchParams.get('id') || ''
  const cfg = settingsStore.load().telegram
  settingsStore.save({ telegram: { ...cfg, watched_chats: (cfg.watched_chats || []).filter((c) => String(c.id) !== id) } })
  return json({ status: manager.status(), syncs: await chatSyncs() })
})
