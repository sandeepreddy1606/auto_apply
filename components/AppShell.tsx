'use client'

/**
 * Client shell around every page: auth gate, toasts, guarded navigation and the
 * bottom nav with its live badges.
 *
 * The Telegram status and the review/new-job counts were polled by the old
 * top-level App component; they live here for the same reason — the bottom nav
 * badges need them on every route.
 */
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { api } from '@/lib/api'
import type { TelegramStatus } from '@/lib/types'

import { AuthProvider } from './AuthProvider'
import { BuildingIcon, GearIcon, GridIcon, ListIcon } from './Icons'
import { NavigationProvider, useNavigate } from './Navigation'
import { ToastProvider } from './Toast'

interface TgContextValue {
  tg: TelegramStatus
  setTg: (s: TelegramStatus) => void
}

const TgContext = createContext<TgContextValue>({
  tg: { state: 'disconnected', error: null, watched_chats: [] },
  setTg: () => {},
})

/** Live Telegram status, shared by the overview, settings hub and nav. */
export const useTelegramStatus = () => useContext(TgContext)

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <AuthProvider>
        <ToastProvider>
          <Chrome>{children}</Chrome>
        </ToastProvider>
      </AuthProvider>
    </NavigationProvider>
  )
}

function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const navigate = useNavigate()
  const [tg, setTg] = useState<TelegramStatus>({
    state: 'disconnected',
    error: null,
    watched_chats: [],
  })
  const [reviewCount, setReviewCount] = useState(0)
  const [newJobsCount, setNewJobsCount] = useState(0)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const [s, st, cj] = await Promise.all([
          api.tgStatus(),
          api.stats(),
          api.companyJobsSummary().catch(() => null),
        ])
        if (!alive) return
        setTg(s)
        setReviewCount(st.by_status?.review || 0)
        if (cj) setNewJobsCount(cj.new_matched || 0)
      } catch {
        /* backend warming up */
      }
    }
    void poll()
    const t = setInterval(poll, 10000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  // '/' -> overview, '/applications/12' -> 'applications', etc.
  const root = pathname.split('/').filter(Boolean)[0] ?? ''
  const active = root === 'paste' ? '' : root

  return (
    <TgContext.Provider value={{ tg, setTg }}>
      <div className="shell">
        <div className="page" key={pathname}>
          {children}
        </div>
      </div>

      <nav className="bottom-nav">
        <button
          className={active === '' ? 'active' : ''}
          title="Overview"
          onClick={() => navigate('/')}
        >
          <GridIcon />
        </button>
        <button
          className={active === 'applications' ? 'active' : ''}
          title="Applications"
          onClick={() => navigate('/applications')}
        >
          <ListIcon />
          {reviewCount > 0 && <span className="nav-dot" />}
        </button>
        <button
          className={active === 'companies' ? 'active' : ''}
          title="Companies"
          onClick={() => navigate('/companies')}
        >
          <BuildingIcon />
          {newJobsCount > 0 && <span className="nav-dot" />}
        </button>
        <button
          className={active === 'settings' ? 'active' : ''}
          title="Settings"
          onClick={() => navigate('/settings')}
        >
          <GearIcon />
        </button>
      </nav>
    </TgContext.Provider>
  )
}
