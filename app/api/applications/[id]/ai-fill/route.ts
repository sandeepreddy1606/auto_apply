import type { PrepareState } from '@/lib/apply/gform-prepare'
import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue, kvGet, kvSet } from '@/lib/tasks/queue'
import type { FormAnswers } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Same key as lib/apply/gform-prepare (kept inline so this route doesn't bundle the AI code).
const prepareKey = (id: number) => `gform.prepare:${id}`

type Ctx = { params: Promise<{ id: string }> }

/**
 * "Fill with AI": the AI answers the form's empty questions from your data
 * (nothing is sent). Answers you typed on the page are saved first as yours,
 * so the AI never replaces them. {redo: true} re-does earlier AI answers.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  const app = await db.getApplication(id)
  if (!app) throw new HttpError(404, 'Post not found')
  if (app.status === 'applying') throw new HttpError(409, 'This post is being applied right now.')
  const body = await readJson<{ answers?: FormAnswers; redo?: boolean }>(req)
  if (body.answers && app.form_schema) {
    const { recordYourAnswers } = await import('@/lib/apply/gform-answers')
    const mine = await recordYourAnswers(app, app.form_schema, body.answers)
    await db.updateApplication(id, { form_answers: mine.answers, form_schema: { ...app.form_schema, answer_meta: mine.meta } })
  }
  const state: PrepareState = { state: 'running', at: new Date().toISOString(), message: 'Waiting for the AI…' }
  await kvSet(prepareKey(id), state)
  await enqueue('llm.gform_prepare', { application_id: id, redo: body.redo === true }, { dedupeKey: `gform-prepare:${id}`, maxAttempts: 1 })
  return json(state)
})

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  return json((await kvGet<PrepareState>(prepareKey(id)))?.value ?? { state: 'idle', at: null })
})
