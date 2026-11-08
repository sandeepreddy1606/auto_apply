import { listSessions } from '@/lib/server/auth'
import { authHandler, requireSession } from '@/lib/server/auth-http'
import { json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = authHandler(async (req: Request) => {
  const { user, session } = await requireSession(req)
  const rows = await listSessions(user.id)
  return json({ sessions: rows.map((r) => ({ ...r, current: r.id === session.id })) })
})
