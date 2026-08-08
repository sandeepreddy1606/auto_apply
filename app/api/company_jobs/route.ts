import * as db from '@/lib/server/db'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams
  const companyId = Number(sp.get('company_id'))
  return json(
    await db.listCompanyJobs({
      view: sp.get('view') || 'matched',
      companyId: Number.isInteger(companyId) && companyId > 0 ? companyId : null,
      q: sp.get('q'),
    }),
  )
})
