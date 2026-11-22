import type { Settings } from '@/lib/types'

import { handler, json, pick, readJson } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

// Mirrors the old SettingsBody model. `resumes` is intentionally absent: it is
// managed through /api/resumes, not by arbitrary settings writes.
const SECTIONS = [
  'profile', 'smtp', 'companies',
  'job_prefs', 'apply_answers', 'resume_prefs', 'ai', 'apply_automation',
] as const

const MASK = '••••••••'

/** Never send secrets back to the browser; the UI shows a mask instead. */
function masked(s: Settings): Settings {
  return s.ai.api_key ? { ...s, ai: { ...s.ai, api_key: MASK } } : s
}

export const GET = handler(async () => json(masked(settingsStore.load())))

export const PUT = handler(async (req: Request) => {
  const payload = pick<Partial<Settings>>(await readJson(req), SECTIONS)
  // An unchanged mask means "keep the stored key".
  if (payload.ai && payload.ai.api_key === MASK) {
    payload.ai = { ...payload.ai, api_key: settingsStore.load().ai.api_key }
  }
  const before = settingsStore.load().job_prefs
  const saved = settingsStore.save(payload)
  if (payload.job_prefs && JSON.stringify(before) !== JSON.stringify(saved.job_prefs)) {
    // Preferences changed: re-score every job in the background.
    const { enqueue } = await import('@/lib/tasks/queue')
    await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' })
    // Amazon/Google/Microsoft are searched with your roles and locations: search again.
    const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    if (!same(before.target_roles, saved.job_prefs.target_roles) || !same(before.locations, saved.job_prefs.locations)) {
      const { queueSearchSites } = await import('@/lib/companies/schedule')
      await queueSearchSites()
    }
  }
  if (payload.profile && JSON.stringify(payload.profile).includes('skills')) {
    const { enqueue } = await import('@/lib/tasks/queue')
    await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' })
  }
  return json(masked(saved))
})
