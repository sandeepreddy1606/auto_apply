import { providerStatus } from '@/lib/llm/provider'
import { handler, json } from '@/lib/server/http'
import { kvGet } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => {
  const status = await providerStatus(false)
  const last = await kvGet<{ ok: boolean; detail: string }>('llm.last_test')
  return json({ ...status, last_test: last ? { ...last.value, at: last.updated_at } : null })
})
