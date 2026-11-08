import { listJobs } from '@/lib/jobs/store'
import type { ListJobsOpts } from '@/lib/jobs/store'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

const VIEWS = new Set(['relevant', 'all', 'shortlisted', 'applied', 'dismissed'])
const SORTS = new Set(['score', 'newest', 'company'])

export const GET = handler(async (req: Request) => {
  const u = new URL(req.url).searchParams
  const view = VIEWS.has(u.get('view') || '') ? (u.get('view') as ListJobsOpts['view']) : 'relevant'
  const sort = SORTS.has(u.get('sort') || '') ? (u.get('sort') as ListJobsOpts['sort']) : 'score'
  const num = (k: string) => {
    const n = Number(u.get(k))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return json(
    await listJobs({
      view,
      sort,
      q: (u.get('q') || '').trim().slice(0, 100) || null,
      companyId: num('company'),
      minScore: num('min_score'),
      limit: num('limit') ?? 100,
      offset: num('offset') ?? 0,
    }),
  )
})
