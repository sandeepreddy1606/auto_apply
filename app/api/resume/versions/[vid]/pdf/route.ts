import fs from 'node:fs'

import { getVersion } from '@/lib/resume/store'
import { HttpError, handler, intParam } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'
import { resumeFileName } from '@/lib/apply/filename'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const v = await getVersion(intParam((await ctx.params).vid))
  if (!v?.pdf_path || !fs.existsSync(v.pdf_path)) throw new HttpError(404, 'No compiled PDF for this version yet.')
  const s = settingsStore.load()
  const name = resumeFileName(s.resume_prefs.filename_pattern, s.profile.full_name || 'Resume')
  const download = new URL(req.url).searchParams.get('download') === '1'
  return new Response(new Uint8Array(fs.readFileSync(v.pdf_path)), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
})
