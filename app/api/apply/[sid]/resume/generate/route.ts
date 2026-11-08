import { canGenerate } from '@/lib/apply/start'
import { getSession, setStatus } from '@/lib/apply/sessions'
import { createVersion, getDefaultBase } from '@/lib/resume/store'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Queue an AI-tailored version of your base resume for this job. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  if (['submitted', 'cancelled', 'submitting', 'filling', 'blocked', 'unconfirmed'].includes(s.status)) {
    throw new HttpError(409, `Can't regenerate the resume while this application is ${s.status.replace('_', ' ')}.`)
  }
  const gate = await canGenerate()
  if (!gate.ok) throw new HttpError(409, gate.reason ?? 'Not available')
  const { hint } = await readJson<{ hint?: string }>(req)
  const base = (await getDefaultBase())!
  const vid = await createVersion({
    base_id: base.id,
    job_id: s.job_id,
    session_id: sid,
    latex: base.latex,
    generated_by: 'llm',
    status: 'generating',
    hint: (hint || '').trim().slice(0, 300) || null,
  })
  await enqueue('resume.tailor', { version_id: vid }, { maxAttempts: 1 })
  if (s.status !== 'resume_drafting') {
    await setStatus(sid, 'resume_drafting', {}, { type: 'resume.generate', actor: 'user', data: { version_id: vid, hint: hint || null } })
  }
  return json({ version_id: vid })
})
