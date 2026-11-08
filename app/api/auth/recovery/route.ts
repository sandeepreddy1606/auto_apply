import { regenerateRecoveryCode } from '@/lib/server/auth'
import { authHandler, requireSession, str } from '@/lib/server/auth-http'
import { json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Replace the recovery code (the old one stops working). */
export const POST = authHandler(async (req: Request) => {
  const { user } = await requireSession(req)
  const code = await regenerateRecoveryCode(user.id, str((await readJson<Record<string, unknown>>(req)).password))
  return json({ recovery_code: code })
})
