/** Route-handler glue for accounts: error mapping, session lookup, cookie responses. */
import { NextResponse } from 'next/server'

import type { SessionInfo, User } from './auth'
import { AuthError, clientMeta, createSession, sessionCookie, sessionFromRequest } from './auth'
import { HttpError, detail } from './http'

/** Like `handler`, but AuthError keeps its status (and Retry-After on lockouts). */
export function authHandler<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (e instanceof AuthError) {
        const res = detail(e.message, e.status)
        if (e.retryAfter) res.headers.set('Retry-After', String(e.retryAfter))
        return res
      }
      if (e instanceof HttpError) return detail(e.message, e.status)
      console.error('[autoapply.auth] unhandled error:', e)
      return detail('Something went wrong. Please try again.', 500)
    }
  }
}

export async function requireSession(req: Request): Promise<{ session: SessionInfo; user: User; token: string }> {
  const s = await sessionFromRequest(req)
  if (!s) throw new AuthError(401, 'Please sign in.')
  return s
}

/**
 * Start a session and answer with the cookie set. The token is also returned
 * in the body for the browser-extension bridge (it reads `aa_token`).
 */
export async function signedIn(
  req: Request,
  user: User,
  remember: boolean,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const { token, expiresAt } = await createSession(user.id, remember, clientMeta(req))
  const res = NextResponse.json({ user, token, ...extra })
  res.headers.append('Set-Cookie', sessionCookie(req, token, remember, expiresAt))
  return res
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
