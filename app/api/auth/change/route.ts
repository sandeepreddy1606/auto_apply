import { changePassword } from '@/lib/server/auth'
import { authHandler, requireSession, str } from '@/lib/server/auth-http'
import { json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Change password; keeps this device signed in and signs out every other one. */
export const POST = authHandler(async (req: Request) => {
  const { user, session } = await requireSession(req)
  const b = await readJson<Record<string, unknown>>(req)
  await changePassword(user.id, str(b.current), str(b.new), session.id)
  return json({ ok: true })
})
