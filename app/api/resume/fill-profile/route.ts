import { getDefaultBase } from '@/lib/resume/store'
import { fillProfileGaps } from '@/lib/resume/profile-fill'
import { HttpError, handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Settings → Profile → "Fill from my resume": copy resume details into empty fields only. */
export const POST = handler(async () => {
  const base = await getDefaultBase()
  if (!base) throw new HttpError(400, 'Add your base resume first (Settings → Resume).')
  return json({ filled: fillProfileGaps(base.latex) })
})
