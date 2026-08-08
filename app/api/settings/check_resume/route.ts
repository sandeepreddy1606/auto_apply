import fs from 'node:fs'
import path from 'node:path'

import { HttpError, handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ path?: string }>(req)
  const p = (body.path || '').trim().replace(/^"|"$/g, '')
  if (!p) throw new HttpError(400, 'No file path provided.')

  let stat: fs.Stats
  try {
    stat = fs.statSync(p)
  } catch {
    return json({ exists: false })
  }
  if (!stat.isFile()) return json({ exists: false })

  return json({
    exists: true,
    filename: path.basename(p),
    size_kb: Math.round((stat.size / 1024) * 10) / 10,
  })
})
