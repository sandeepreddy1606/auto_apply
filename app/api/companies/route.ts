import { queueScan } from '@/lib/companies/schedule'
import { normalizeCareerUrl } from '@/lib/companies/url'
import * as db from '@/lib/server/db'
import { HttpError, handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json(await db.listCompanies()))

/** Add a careers page; its first scan is queued straight away. */
export const POST = handler(async (req: Request) => {
  const body = await readJson<{ name?: string; career_url?: string }>(req)
  const name = (body.name || '').trim()
  if (!name) throw new HttpError(400, 'Company name is required.')
  const url = normalizeCareerUrl(body.career_url || '')
  let created
  try {
    created = await db.addCompany(name, url)
  } catch (e) {
    const msg = String((e as Error).message).toLowerCase()
    if (msg.includes('unique') || msg.includes('duplicate')) {
      throw new HttpError(409, 'That career page URL is already added.')
    }
    throw e
  }
  if (created) await queueScan(created.id)
  return json(await db.getCompany(created!.id))
})
