import fs from 'node:fs'

import { getArtifact } from '@/lib/apply/sessions'
import { HttpError, handler, intParam } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Screenshot bytes (fetched by the UI with its auth header, shown via a blob URL). */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ aid: string }> }) => {
  const a = await getArtifact(intParam((await ctx.params).aid))
  if (!a || !fs.existsSync(a.path)) throw new HttpError(404, 'Screenshot not found')
  const type = a.path.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return new Response(new Uint8Array(fs.readFileSync(a.path)), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' },
  })
})
