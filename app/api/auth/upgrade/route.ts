import { upgradeLegacy } from '@/lib/server/auth'
import { authHandler, signedIn, str } from '@/lib/server/auth-http'
import { readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Turn the old single dashboard password into an account. */
export const POST = authHandler(async (req: Request) => {
  const b = await readJson<Record<string, unknown>>(req)
  const { user, recoveryCode } = await upgradeLegacy({
    currentPassword: str(b.current_password),
    name: str(b.name),
    email: str(b.email),
    newPassword: str(b.new_password) || undefined,
  })
  return signedIn(req, user, true, { recovery_code: recoveryCode })
})
