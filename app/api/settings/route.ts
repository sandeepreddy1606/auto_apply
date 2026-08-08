import type { Settings } from '@/lib/types'

import { handler, json, pick, readJson } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

// Mirrors the old SettingsBody model. `resumes` is intentionally absent: it is
// managed through /api/resumes, not by arbitrary settings writes.
const SECTIONS = [
  'profile', 'smtp', 'email_template', 'telegram', 'automation', 'companies',
] as const

export const GET = handler(async () => json(settingsStore.load()))

export const PUT = handler(async (req: Request) => {
  const payload = pick<Partial<Settings>>(await readJson(req), SECTIONS)
  return json(settingsStore.save(payload))
})
