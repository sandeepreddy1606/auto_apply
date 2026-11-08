import { previewRelevantCount } from '@/lib/jobs/store'
import { handler, json, readJson } from '@/lib/server/http'
import type { JobPrefs } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Live "N of M jobs relevant" while you edit Job preferences (nothing is saved). */
export const POST = handler(async (req: Request) => {
  const prefs = await readJson<Partial<JobPrefs>>(req)
  return json(await previewRelevantCount(prefs))
})
