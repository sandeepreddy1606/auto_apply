import { updateProfile } from '@/lib/server/auth'
import { authHandler, requireSession, str } from '@/lib/server/auth-http'
import { json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = authHandler(async (req: Request) => {
  const { user, session } = await requireSession(req)
  return json({ user, session_id: session.id })
})

export const PATCH = authHandler(async (req: Request) => {
  const { user } = await requireSession(req)
  const b = await readJson<Record<string, unknown>>(req)
  const updated = await updateProfile(user.id, {
    name: typeof b.name === 'string' ? b.name : undefined,
    email: typeof b.email === 'string' ? b.email : undefined,
    password: str(b.password) || undefined,
  })
  return json({ user: updated })
})
