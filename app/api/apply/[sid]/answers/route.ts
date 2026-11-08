import { getSession } from '@/lib/apply/sessions'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'
import { enqueue } from '@/lib/tasks/queue'
import type { AnswerValue, ApplyAnswers } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Your edits from the review screen. They're applied to the live form by the
 * worker and (by default) remembered in the answer bank. `save_to_answers`
 * also stores a value as a permanent Application answer.
 */
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s?.fill_plan) throw new HttpError(409, 'Fill the form first.')
  if (!['reviewing', 'needs_input', 'blocked'].includes(s.status)) {
    throw new HttpError(409, `Can't edit answers while ${s.status.replace('_', ' ')}.`)
  }
  const body = await readJson<{ values?: Record<string, AnswerValue>; remember?: boolean; save_to_answers?: Record<string, string> }>(req)
  const values: Record<string, AnswerValue> = {}
  for (const [id, v] of Object.entries(body.values ?? {})) {
    if (!s.fill_plan.fields.some((f) => f.id === id)) continue
    if (typeof v === 'string') values[id] = v.slice(0, 5000)
    else if (typeof v === 'boolean' || v === null) values[id] = v
    else if (Array.isArray(v)) values[id] = v.filter((x) => typeof x === 'string').slice(0, 30)
  }
  if (!Object.keys(values).length) throw new HttpError(400, 'No answers to apply.')
  if (body.save_to_answers) {
    const allowed = Object.keys(settingsStore.DEFAULTS.apply_answers)
    const patch: Partial<ApplyAnswers> = {}
    for (const [k, v] of Object.entries(body.save_to_answers)) {
      if (allowed.includes(k) && typeof v === 'string') (patch as Record<string, string>)[k] = v
    }
    if (Object.keys(patch).length) {
      settingsStore.save({ apply_answers: { ...settingsStore.load().apply_answers, ...patch } })
    }
  }
  const task = await enqueue('apply.answers', { session_id: sid, values, remember: body.remember !== false })
  return json({ task_id: task })
})
