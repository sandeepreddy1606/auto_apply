import type { FormAnswers } from '@/lib/types'

import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import * as service from '@/lib/server/service'

export const dynamic = 'force-dynamic'

interface ApplyBody {
  to?: string
  subject?: string
  body?: string
  answers?: FormAnswers | null
}

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = intParam((await ctx.params).id)
  const record = await db.getApplication(id)
  if (!record) throw new HttpError(404, 'Application not found')
  if (record.status === 'applied') throw new HttpError(400, 'Already applied.')

  const body = await readJson<ApplyBody>(req)
  const overrides: { to?: string; subject?: string; body?: string } = {}
  for (const k of ['to', 'subject', 'body'] as const) {
    if (body[k]) overrides[k] = body[k]
  }

  // With explicit content (from the detail page) use it; otherwise fall back to
  // the automated one-shot path.
  try {
    let updated
    if (record.method === 'email' && Object.keys(overrides).length) {
      updated = await service.applyEmail(record, overrides)
    } else if (record.method === 'gform' && body.answers !== undefined && body.answers !== null) {
      updated = await service.applyGform(record, body.answers)
    } else {
      updated = await service.autoApply(record)
    }
    return json(updated)
  } catch (e) {
    // Google Form couldn't be auto-submitted — draft saved, return the
    // questions still needing the user's input (not an error / not failed).
    if (e instanceof service.NeedsInput) {
      return json({
        ...(await db.getApplication(id)),
        needs_input: true,
        unanswered_required: e.missing,
      })
    }
    throw new HttpError(400, (e as Error).message)
  }
})
