import { sessionFromRequest, setupState } from '@/lib/server/auth'
import { authHandler } from '@/lib/server/auth-http'
import { json } from '@/lib/server/http'
import { load } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

/** What the sign-in screens need: which step to show, and who is signed in. */
export const GET = authHandler(async (req: Request) => {
  const state = await setupState()
  const current = state === 'login' ? await sessionFromRequest(req) : null
  const smtp = load().smtp
  return json({
    state: current ? 'ready' : state,
    user: current?.user ?? null,
    email_reset: Boolean(smtp.host && smtp.username && smtp.password),
  })
})
