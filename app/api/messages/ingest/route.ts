import { HttpError, handler, json, readJson } from '@/lib/server/http'
import * as service from '@/lib/server/service'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ text?: string; channel?: string }>(req)
  let records
  try {
    records = await service.ingestText(body.text || '', 'manual', body.channel ?? null)
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
  if (!records.length) {
    throw new HttpError(409, 'This message was already ingested (duplicate).')
  }
  return json({ created: records })
})
