import type { BatchItemResult } from '@/lib/types'

import * as db from '@/lib/server/db'
import { handler, json, readJson } from '@/lib/server/http'
import * as service from '@/lib/server/service'

export const dynamic = 'force-dynamic'

/**
 * One-click bulk apply. Applies each id via the automated path and reports
 * per-item outcomes; skips already-applied and unknown-method posts.
 */
export const POST = handler(async (req: Request) => {
  const body = await readJson<{ ids?: unknown }>(req)
  const ids = (Array.isArray(body.ids) ? body.ids : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200)

  const results: BatchItemResult[] = []
  for (const appId of ids) {
    const record = await db.getApplication(appId)
    if (!record) {
      results.push({ id: appId, ok: false, error: 'not found' })
      continue
    }
    if (record.status === 'applied') {
      results.push({ id: appId, ok: true, skipped: 'already applied' })
      continue
    }
    try {
      const updated = await service.autoApply(record)
      if (!updated) {
        results.push({
          id: appId,
          ok: false,
          job_title: record.job_title,
          error: 'removed during apply',
        })
        continue
      }
      const ok = updated.status === 'applied'
      results.push({
        id: appId,
        ok,
        job_title: updated.job_title,
        error: ok ? null : updated.error,
      })
    } catch (e) {
      if (e instanceof service.NeedsInput) {
        // Draft saved; the user must finish these — not a failure.
        results.push({
          id: appId,
          ok: false,
          needs_input: true,
          job_title: record.job_title,
          error: `${e.missing.length} question(s) need your input`,
        })
        continue
      }
      // One bad item must never abort the batch or discard prior results.
      results.push({
        id: appId,
        ok: false,
        job_title: record.job_title,
        error: (e as Error).message,
      })
    }
  }

  const applied = results.filter((r) => r.ok && !r.skipped).length
  const needsInput = results.filter((r) => r.needs_input).length
  return json({ applied, needs_input: needsInput, total: results.length, results })
})
