import { parseJobQuery } from '@/lib/jobs/filter-params'
import { listJobs } from '@/lib/jobs/store'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** The Jobs list: tab, search, sort and every filter from the panel (see lib/jobs/filter-params.ts). */
export const GET = handler(async (req: Request) => json(await listJobs(parseJobQuery(new URL(req.url).searchParams))))
