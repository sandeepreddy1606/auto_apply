import { signUp } from '@/lib/server/auth'
import { authHandler, signedIn, str } from '@/lib/server/auth-http'
import { readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** First-run sign-up (closes once the owner account exists). */
export const POST = authHandler(async (req: Request) => {
  const b = await readJson<Record<string, unknown>>(req)
  const { user, recoveryCode } = await signUp({ name: str(b.name), email: str(b.email), password: str(b.password) })
  return signedIn(req, user, true, { recovery_code: recoveryCode })
})
