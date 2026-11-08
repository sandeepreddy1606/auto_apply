import { NextResponse } from 'next/server'

import { clearSessionCookie, revokeToken, tokenFromRequest } from '@/lib/server/auth'
import { authHandler } from '@/lib/server/auth-http'

export const dynamic = 'force-dynamic'

export const POST = authHandler(async (req: Request) => {
  const t = tokenFromRequest(req)
  if (t) await revokeToken(t.token)
  const res = NextResponse.json({ ok: true })
  res.headers.append('Set-Cookie', clearSessionCookie(req))
  return res
})
