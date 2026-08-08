import * as db from '@/lib/server/db'
import { HttpError, handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export function normalizeCareerUrl(raw: string): string {
  let url = (raw || '').trim().replace(/^"|"$/g, '')
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new HttpError(400, "That doesn't look like a valid URL.")
  }
  if (!parsed.host || !parsed.host.includes('.')) {
    throw new HttpError(400, "That doesn't look like a valid URL.")
  }
  return url.replace(/\/+$/, '')
}

export const GET = handler(async () => json(await db.listCompanies()))

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ name?: string; career_url?: string }>(req)
  const name = (body.name || '').trim()
  if (!name) throw new HttpError(400, 'Company name is required.')
  const url = normalizeCareerUrl(body.career_url || '')
  try {
    return json(await db.addCompany(name, url))
  } catch (e) {
    const msg = String((e as Error).message).toLowerCase()
    if (msg.includes('unique') || msg.includes('duplicate')) {
      throw new HttpError(409, 'That career page URL is already added.')
    }
    throw e
  }
})
