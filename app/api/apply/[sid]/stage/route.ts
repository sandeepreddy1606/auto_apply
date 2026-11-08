import { getSession, setStage } from '@/lib/apply/sessions'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import type { AppStage } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STAGES: AppStage[] = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted']

/** Track what happened after you applied. */
export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  if (s.status !== 'submitted') throw new HttpError(409, 'Stages apply to submitted applications.')
  const { stage, notes } = await readJson<{ stage?: AppStage; notes?: string }>(req)
  if (!stage || !STAGES.includes(stage)) throw new HttpError(400, `stage must be one of ${STAGES.join(', ')}`)
  await setStage(sid, stage, typeof notes === 'string' ? notes.slice(0, 2000) : null)
  return json(await getSession(sid))
})
