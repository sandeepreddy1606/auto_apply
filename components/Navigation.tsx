'use client'

/**
 * Guarded navigation.
 *
 * The App Router has no built-in "block this navigation" hook, so the previous
 * build's behaviour — every in-app navigation confirms before discarding
 * unsaved edits — is preserved by routing all navigation through `navigate()`
 * here instead of calling router.push directly.
 */
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

type Guard = () => boolean

interface NavContext {
  navigate: (to: string, opts?: { force?: boolean }) => void
  setNavGuard: (fn: Guard | null) => void
}

const Ctx = createContext<NavContext | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const guard = useRef<Guard | null>(null)

  const setNavGuard = useCallback((fn: Guard | null) => {
    guard.current = fn
  }, [])

  const navigate = useCallback(
    (to: string, { force = false }: { force?: boolean } = {}) => {
      if (!force && guard.current?.()) {
        if (!window.confirm('You have unsaved changes. Discard them?')) return
        guard.current = null // proceeding — drop the guard so it doesn't re-prompt
      }
      router.push(to)
    },
    [router],
  )

  const value = useMemo(() => ({ navigate, setNavGuard }), [navigate, setNavGuard])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNavigate() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNavigate must be used inside NavigationProvider')
  return ctx.navigate
}

export function useNavGuard() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNavGuard must be used inside NavigationProvider')
  return ctx.setNavGuard
}
