import { getCall } from '@/lib/llm/provider'
import { getVersion, updateVersion } from '@/lib/resume/store'
import { validatePlan } from '@/lib/resume/plan'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ vid: string }> }

/** The prompt to copy into claude.ai when the AI runs in manual mode. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const v = await getVersion(intParam((await ctx.params).vid))
  if (!v?.llm_call_id) throw new HttpError(404, 'This version has no AI request.')
  const call = await getCall(v.llm_call_id)
  if (!call) throw new HttpError(404, 'AI request not found')
  const text = [
    call.system_prompt,
    '',
    call.prompt,
    '',
    'Reply with ONLY a JSON object matching this JSON Schema:',
    JSON.stringify(call.schema),
  ].join('\n')
  return json({ prompt: text, reason: call.error })
})

/** Paste the answer you got from claude.ai; validation + guards run in the worker. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).vid)
  const v = await getVersion(id)
  if (!v || v.status !== 'awaiting_manual') throw new HttpError(409, 'This version isn’t waiting for an answer.')
  const { answer } = await readJson<{ answer?: string }>(req)
  if (!answer?.trim()) throw new HttpError(400, 'Paste the JSON answer.')
  // Fail fast on obviously invalid JSON so you get the error right here.
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer)
    const body = (fenced ? fenced[1] : answer).trim()
    validatePlan(JSON.parse(body.slice(body.indexOf('{'))))
  } catch (e) {
    throw new HttpError(400, `That answer isn’t a valid plan: ${(e as Error).message}`)
  }
  await updateVersion(id, { status: 'generating', error: null })
  await enqueue('resume.finish_manual', { version_id: id, answer }, { maxAttempts: 1 })
  return json({ ok: true })
})
