import { providerStatus } from '@/lib/llm/provider'
import { handler, json } from '@/lib/server/http'
import { kvSet } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** A tiny real call through Claude Code to confirm you're signed in (uses a sliver of your Pro limit). */
export const POST = handler(async () => {
  const status = await providerStatus(true)
  await kvSet('llm.last_test', { ok: status.ok, detail: status.detail })
  return json(status)
})
