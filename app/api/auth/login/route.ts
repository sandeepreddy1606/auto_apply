import { clientMeta, login } from '@/lib/server/auth'
import { authHandler, signedIn, str } from '@/lib/server/auth-http'
import { readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const POST = authHandler(async (req: Request) => {
  const b = await readJson<Record<string, unknown>>(req)
  const user = await login(str(b.email), str(b.password), clientMeta(req))
  return signedIn(req, user, b.remember !== false)
})
