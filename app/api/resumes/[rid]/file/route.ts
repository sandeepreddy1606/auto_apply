import fs from 'node:fs'

import { HttpError, handler } from '@/lib/server/http'
import * as resumeStore from '@/lib/server/resumes'

export const dynamic = 'force-dynamic'

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ rid: string }> }) => {
  const { rid } = await ctx.params
  const path = resumeStore.pathFor(rid)
  if (!path) throw new HttpError(404, 'Resume file not found.')

  const filename = resumeStore.filenameFor(rid)
  // Quote-escape so a filename with a quote can't break out of the header.
  const safe = filename.replace(/["\\]/g, '_')
  return new Response(new Uint8Array(fs.readFileSync(path)), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safe}"`,
    },
  })
})
