import { HttpError, handler, json, readJson } from '@/lib/server/http'
import { chatSyncs, manager } from '@/lib/server/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * "Check now": read new posts from one group (or all watched groups). With
 * `days`, re-read that many days back — posts already in the inbox are skipped.
 */
export const POST = handler(async (req: Request) => {
  const { id, days } = await readJson<{ id?: string; days?: number }>(req)
  if (manager.state !== 'connected') throw new HttpError(409, 'Telegram isn’t connected — connect it first.')
  let created = 0
  let found = 0
  if (id) {
    const r = days ? await manager.fetchHistory(String(id), { days: Math.min(Math.max(Number(days), 1), 30) }) : await manager.fetchHistory(String(id), { sinceLast: true })
    created = r.created
    found = r.found
  } else {
    created = await manager.catchUp()
  }
  return json({ created, found, syncs: await chatSyncs() })
})
