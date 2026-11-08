import { factsForBase, getBase, getDefaultBase, getOverlay, saveOverlay } from '@/lib/resume/store'
import { HttpError, handler, json, readJson } from '@/lib/server/http'
import { cleanList } from '@/lib/server/settings'
import { enqueue } from '@/lib/tasks/queue'
import type { FactOverlay } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function baseFrom(id: unknown) {
  const n = Number(id)
  const b = Number.isInteger(n) && n > 0 ? await getBase(n) : await getDefaultBase()
  if (!b) throw new HttpError(404, 'No base resume yet.')
  return b
}

/** The effective fact bank (derived from the base + your overlay) and the overlay itself. */
export const GET = handler(async (req: Request) => {
  const b = await baseFrom(new URL(req.url).searchParams.get('base'))
  return json({ base_id: b.id, facts: await factsForBase(b), overlay: await getOverlay(b.id) })
})

export const PUT = handler(async (req: Request) => {
  const body = await readJson<{ base_id?: number; overlay?: Partial<FactOverlay> }>(req)
  const b = await baseFrom(body.base_id)
  const cur = await getOverlay(b.id)
  const o = body.overlay ?? {}
  const extra: FactOverlay['extra_bullets'] = {}
  for (const [entry, list] of Object.entries(o.extra_bullets ?? cur.extra_bullets)) {
    if (!Array.isArray(list)) continue
    extra[entry] = list
      .filter((x) => x && typeof x.text === 'string' && x.text.trim())
      .slice(0, 20)
      .map((x, i) => ({ id: /^x\d+$/.test(String(x.id)) ? String(x.id) : `x${i + 1}`, text: x.text.trim().slice(0, 400) }))
  }
  const next: FactOverlay = {
    extra_bullets: extra,
    inventory_extra: o.inventory_extra ? cleanList(o.inventory_extra) : cur.inventory_extra,
    locked: o.locked ? cleanList(o.locked) : cur.locked,
  }
  await saveOverlay(b.id, next)
  await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' })
  return json({ base_id: b.id, facts: await factsForBase(b), overlay: next })
})
