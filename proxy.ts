/**
 * Auth gate for /api: everything needs a signed-in session except a small
 * public allowlist (sign-up, sign-in, password reset, health).
 *
 * The session comes from the httpOnly `aa_session` cookie (the web app), an
 * `Authorization: Bearer` header (the browser extension, scripts) or `?token=`
 * on live event streams. Cookie-authenticated writes must come from this app
 * (Sec-Fetch-Site / Origin check) so another site can't act on your behalf.
 *
 * Next 16's proxy runs on the Node.js runtime, which this needs (node:crypto
 * and the database).
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isCrossSite, resolveSession, tokenFromRequest } from '@/lib/server/auth'

const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/upgrade',
  '/api/auth/forgot',
  '/api/auth/reset',
  '/api/auth/logout',
])

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (request.method === 'OPTIONS' || !pathname.startsWith('/api')) return NextResponse.next()

  const t = tokenFromRequest(request)
  if (!SAFE.has(request.method) && t?.via !== 'bearer' && isCrossSite(request)) {
    return NextResponse.json({ detail: 'Cross-site request blocked.' }, { status: 403 })
  }
  if (PUBLIC_API.has(pathname)) return NextResponse.next()

  if (!t || !(await resolveSession(t.token))) {
    return NextResponse.json({ detail: 'Please sign in.' }, { status: 401 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
