import { bearerFrom, isPasswordSet, verifyToken } from '@/lib/server/auth'
import { handler, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: Request) => {
  const token = bearerFrom(req.headers.get('authorization'))
  return json({
    password_set: isPasswordSet(),
    authenticated: verifyToken(token),
  })
})
