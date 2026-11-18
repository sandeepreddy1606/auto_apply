import { parseJobQuery } from '@/lib/jobs/filter-params'
import { jobFacets } from '@/lib/jobs/store'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Counts for every filter option, for the current tab, search and other filters. */
export const GET = handler(async (req: Request) => json(await jobFacets(parseJobQuery(new URL(req.url).searchParams))))
