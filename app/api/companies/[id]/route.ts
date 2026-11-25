import { tidyCompanyName } from '@/lib/companies/names'
import { normalizeCareerUrl } from '@/lib/companies/url'
import { queueScan } from '@/lib/companies/schedule'
import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

const PRIORITIES = ['high', 'normal', 'low']

/** Rename, change the careers URL, priority (part of the score), or pause/resume scanning. */
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  const before = await db.getCompany(id)
  if (!before) throw new HttpError(404, 'Company not found')
  const body = await readJson<{ priority?: string; paused?: boolean; name?: string; career_url?: string }>(req)
  const fields: Record<string, unknown> = {}
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) throw new HttpError(400, 'priority must be high, normal or low')
    fields.priority = body.priority
  }
  if (body.paused !== undefined) fields.paused = body.paused ? 1 : 0
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw new HttpError(400, 'Company name can’t be empty.')
    fields.name = tidyCompanyName(name).slice(0, 120)
  }
  const urlChanged = body.career_url !== undefined && normalizeCareerUrl(String(body.career_url)) !== before.career_url
  if (urlChanged) {
    fields.career_url = normalizeCareerUrl(String(body.career_url))
    // A different page: detect its job board again, from a clean slate.
    Object.assign(fields, { ats_type: null, ats_token: null, fail_count: 0, next_scan_at: null, last_error: null, last_status: null })
  }
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to change.')
  let c
  try {
    c = await db.updateCompany(id, fields)
  } catch (e) {
    if (/unique|duplicate/i.test(String((e as Error).message))) throw new HttpError(409, 'Another company already uses that careers URL.')
    throw e
  }
  if (fields.priority) await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' })
  if (urlChanged || body.paused === false) await queueScan(id)
  return json(c)
})

/**
 * Remove a company and its scanned jobs. Refused while you have applications
 * for its jobs — deleting would erase them from your tracker; pause it instead.
 */
export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  const c = await db.getCompany(id)
  if (!c) throw new HttpError(404, 'Company not found')
  const apps = await db.companyApplicationCount(id)
  if (apps > 0) {
    throw new HttpError(409, `You have ${apps} application${apps > 1 ? 's' : ''} for ${c.name}; removing it would erase ${apps > 1 ? 'them' : 'it'} from your tracker. Pause scanning instead.`)
  }
  await db.deleteCompany(id)
  return json({ ok: true })
})
