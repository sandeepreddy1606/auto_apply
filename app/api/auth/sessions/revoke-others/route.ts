import { revokeOtherSessions } from '@/lib/server/auth'
import { authHandler, requireSession } from '@/lib/server/auth-http'
import { json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const POST = authHandler(async (req: Request) => {
  const { user, session } = await requireSession(req)
  return json({ revoked: await revokeOtherSessions(user.id, session.id) })
})
