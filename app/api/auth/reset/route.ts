import { clientMeta, resetPassword } from '@/lib/server/auth'
import { authHandler, signedIn, str } from '@/lib/server/auth-http'
import { readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** New password via emailed code or recovery code; signs out every device, then signs you in here. */
export const POST = authHandler(async (req: Request) => {
  const b = await readJson<Record<string, unknown>>(req)
  const { user, newRecoveryCode } = await resetPassword({
    email: str(b.email),
    password: str(b.password),
    code: str(b.code) || undefined,
    recoveryCode: str(b.recovery_code) || undefined,
    meta: clientMeta(req),
  })
  return signedIn(req, user, true, newRecoveryCode ? { recovery_code: newRecoveryCode } : {})
})
