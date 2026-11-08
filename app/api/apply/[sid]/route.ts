import { gatesFor } from '@/lib/apply/start'
import { eventsSince, getSession, listArtifacts } from '@/lib/apply/sessions'
import { getJob } from '@/lib/jobs/store'
import { listVersionsForSession, lockedVersions } from '@/lib/resume/store'
import { similarity } from '@/lib/resume/tailor'
import { analyzeJd } from '@/lib/jobs/analyze'
import { HttpError, handler, intParam, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Everything the apply page needs in one call. */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const session = await getSession(sid)
  if (!session) throw new HttpError(404, 'Application not found')
  const job = await getJob(session.job_id)
  const versions = (await listVersionsForSession(sid)).map(({ latex: _l, ...v }) => v)
  const events = await eventsSince(sid, 0)

  // Earlier locked versions for similar jobs, best match first.
  let reuse: { id: number; job_title: string; company_name: string; similarity: number }[] = []
  if (job?.description_text) {
    const mine = analyzeJd(job.title, job.description_text)
    const mineKeys = [...mine.required, ...mine.preferred, ...mine.keywords]
    reuse = (await lockedVersions(sid))
      .map((v) => {
        const other = analyzeJd(v.job_title, v.description_text || v.job_title)
        return { id: v.id, job_title: v.job_title, company_name: v.company_name, similarity: similarity(mineKeys, [...other.required, ...other.preferred, ...other.keywords]) }
      })
      .filter((v) => v.similarity >= 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
  }

  return json({
    session,
    job,
    versions,
    events: events.slice(-150),
    artifacts: await listArtifacts(sid),
    gates: await gatesFor(sid),
    reuse,
  })
})
