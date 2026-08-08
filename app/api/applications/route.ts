import * as db from '@/lib/server/db'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams
  return json(
    await db.listApplications({
      status: sp.get('status'),
      method: sp.get('method'),
      q: sp.get('q'),
    }),
  )
})
