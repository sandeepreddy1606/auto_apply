import { restartWorker } from '@/lib/server/worker-supervisor'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Settings → Setup & health → "Restart worker". */
export const POST = handler(async () => {
  await restartWorker()
  return json({ ok: true })
})
