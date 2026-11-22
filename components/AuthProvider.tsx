'use client'

/**
 * Session gate for the app. Sign-in lives on real pages (/login, /signup,
 * /forgot); every other route waits here until the session is confirmed and
 * otherwise redirects to the right one, remembering where you were going.
 */
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { AuthStatus, AuthUser, SignedIn } from '@/lib/api'
import { UNAUTHORIZED_EVENT, api } from '@/lib/api'
import { BoltIcon } from '@/components/Icons'

export const AUTH_ROUTES = ['/login', '/signup', '/forgot']
export const isAuthRoute = (p: string) => AUTH_ROUTES.some((r) => p === r || p.startsWith(`${r}/`))

interface AuthContextValue {
  status: AuthStatus | null
  user: AuthUser | null
  /** Re-read /api/auth/status. */
  refresh: () => Promise<AuthStatus | null>
  /** Call after a successful sign-in/up/reset response. */
  signedIn: (res: SignedIn) => void
  setUser: (u: AuthUser) => void
  logout: () => Promise<void>
  /** Where to go after signing in (the page that sent you to /login). */
  nextPath: () => string
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

function safeNext(raw: string | null): string {
  // Only same-app paths: "/jobs?x=1" yes, "//evil.com" or "https://…" no.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || isAuthRoute(raw.split('?')[0])) return '/'
  return raw
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [offline, setOffline] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await api.authStatus()
      setStatus(s)
      setOffline(false)
      return s
    } catch {
      // Server unreachable (restarting) — retry instead of bouncing to login.
      setOffline(true)
      setTimeout(() => void refresh(), 2000)
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Session expired or revoked from another device.
  useEffect(() => {
    const onUnauth = () => {
      setStatus((s) => (s && s.state === 'ready' ? { ...s, state: 'login', user: null } : s))
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauth)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauth)
  }, [])

  const onAuthPage = isAuthRoute(pathname)

  // Redirects: signed-out users to /login or /signup; signed-in users off the auth pages.
  useEffect(() => {
    if (!status) return
    if (status.state === 'ready') {
      // /signup and /forgot redirect themselves — they may still be showing a
      // one-time recovery code after you're signed in.
      if (pathname === '/login') router.replace(safeNext(new URLSearchParams(window.location.search).get('next')))
      return
    }
    if (onAuthPage) {
      // Send you to the screen that matches the app's state.
      if (status.state !== 'login' && pathname === '/login') router.replace('/signup')
      if (status.state === 'login' && pathname === '/signup') router.replace('/login')
      return
    }
    const here = window.location.pathname + window.location.search
    const target = status.state === 'login' ? '/login' : '/signup'
    router.replace(here && here !== '/' ? `${target}?next=${encodeURIComponent(here)}` : target)
  }, [status, onAuthPage, pathname, router])

  const signedIn = useCallback((res: SignedIn) => {
    setStatus((s) => ({ state: 'ready', user: res.user, email_reset: s?.email_reset ?? false }))
  }, [])

  const setUser = useCallback((u: AuthUser) => {
    setStatus((s) => (s ? { ...s, user: u } : s))
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* the cookie is cleared server-side when reachable; carry on locally */
    }
    setStatus((s) => ({ state: 'login', user: null, email_reset: s?.email_reset ?? false }))
    router.replace('/login')
  }, [router])

  const nextPath = useCallback(() => safeNext(new URLSearchParams(window.location.search).get('next')), [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: status?.user ?? null, refresh, signedIn, setUser, logout, nextPath }),
    [status, refresh, signedIn, setUser, logout, nextPath],
  )

  let body: ReactNode
  if (onAuthPage) body = status ? children : <Splash offline={offline} />
  else body = status?.state === 'ready' ? children : <Splash offline={offline} />

  return <AuthContext.Provider value={value}>{body}</AuthContext.Provider>
}

function Splash({ offline }: { offline: boolean }) {
  return (
    <div className="auth-splash" aria-busy="true">
      <div className="auth-mark"><BoltIcon fill="currentColor" strokeWidth={0} style={{ width: 17, height: 17 }} /></div>
      <p className="muted">{offline ? 'Waiting for the server to start…' : 'Loading…'}</p>
    </div>
  )
}
