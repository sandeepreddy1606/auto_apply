import { handler, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Open the automation browser so you can sign in to Workday/iCIMS accounts once. */
export const POST = handler(async (req: Request) => {
  const { url } = await readJson<{ url?: string }>(req)
  const safe = typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url) ? url : 'about:blank'
  return json({ task_id: await enqueue('browser.open_profile', { url: safe }) })
})
