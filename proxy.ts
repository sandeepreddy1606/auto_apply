/**
 * Auth gate for /api. Mirrors the FastAPI `_auth_gate` middleware: everything
 * under /api needs a bearer token except a small public allowlist.
 *
 * Next 16's proxy file always runs on the Node.js runtime, which this needs:
 * token verification uses node:crypto and reads data/auth.json.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { bearerFrom, isPasswordSet, verifyToken } from '@/lib/server/auth'

// Endpoints reachable without a token. Everything else under /api requires one.
const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/setup',
])

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Non-API routes (the app UI) and CORS preflight pass through.
  if (
    request.method === 'OPTIONS' ||
    !pathname.startsWith('/api') ||
    PUBLIC_API.has(pathname)
  ) {
    return NextResponse.next()
  }

  // No password configured yet -> block real endpoints so the UI can bootstrap
  // through the setup flow only.
  if (!isPasswordSet()) {
    return NextResponse.json({ detail: 'Set up a password first.' }, { status: 401 })
  }

  if (!verifyToken(bearerFrom(request.headers.get('authorization')))) {
    return NextResponse.json({ detail: 'Not authenticated.' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
