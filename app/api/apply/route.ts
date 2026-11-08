import { listSessions } from '@/lib/apply/sessions'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Applications tracker: every session with its job and company. */
export const GET = handler(async (req: Request) => {
  const status = new URL(req.url).searchParams.get('status')
  const rows = await listSessions({ status })
  // The plan can be large; the tracker only needs a summary.
  return json(
    rows.map(({ fill_plan, jd_snapshot: _jd, ...r }) => ({
      ...r,
      fields: fill_plan?.fields.length ?? 0,
      needs_you: fill_plan ? Object.values(fill_plan.answers).filter((a) => a.needs_you).length : 0,
    })),
  )
})
