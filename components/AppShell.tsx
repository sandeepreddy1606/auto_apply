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

import { AuthProvider, isAuthRoute, useAuth } from './AuthProvider'
import { BriefcaseIcon, BuildingIcon, GearIcon, GridIcon, KanbanIcon, ListIcon } from './Icons'
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

/** Sidebar on laptops, bottom tab bar on phones (CSS switches at 1024px). */
const NAV = [
  { key: '', to: '/', label: 'Overview', Icon: GridIcon, mobile: true },
  { key: 'jobs', to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon, mobile: true },
  { key: 'tracker', to: '/tracker', label: 'Applications', Icon: KanbanIcon, mobile: true },
  { key: 'companies', to: '/companies', label: 'Companies', Icon: BuildingIcon, mobile: false },
  { key: 'applications', to: '/applications', label: 'Telegram inbox', Icon: ListIcon, mobile: true },
  { key: 'settings', to: '/settings', label: 'Settings', Icon: GearIcon, mobile: true },
]

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <AuthProvider>
        <ToastProvider>
          <Frame>{children}</Frame>
        </ToastProvider>
      </AuthProvider>
    </NavigationProvider>
  )
}

/** Sign-in pages render full-screen, without the sidebar and tab bar. */
function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return isAuthRoute(pathname) ? <>{children}</> : <Chrome>{children}</Chrome>
}

function initials(name: string, email: string): string {
  const parts = (name || email).trim().split(/\s+/).filter(Boolean)
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)
  return s.toUpperCase()
}

function UserChip() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  if (!user) return null
  return (
    <div className="side-user">
      <button className="side-user-main" onClick={() => navigate('/settings/security')} title="Account & security">
        <span className="avatar" aria-hidden="true">{initials(user.name, user.email)}</span>
        <span className="side-user-text">
          <b>{user.name || 'Account'}</b>
          <small>{user.email}</small>
        </span>
      </button>
      <button className="side-signout" onClick={() => void logout()} title="Sign out" aria-label="Sign out">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </button>
    </div>
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
  // /apply/<sid> belongs to Jobs; /paste to the overview.
  const active = root === 'paste' ? '' : root === 'apply' ? 'jobs' : root

  return (
    <TgContext.Provider value={{ tg, setTg }}>
      <div className="shell">
        <div className="page" key={pathname}>
          {children}
        </div>
      </div>

      <aside className="sidebar" aria-label="Main">
        <div className="sidebar-brand">⚡ Auto Apply</div>
        {NAV.map((n) => (
          <button
            key={n.to}
            className={active === n.key ? 'side-link active' : 'side-link'}
            onClick={() => navigate(n.to)}
          >
            <n.Icon />
            <span>{n.label}</span>
            {n.key === 'applications' && reviewCount > 0 && <span className="side-badge">{reviewCount}</span>}
            {n.key === 'jobs' && newJobsCount > 0 && <span className="side-badge">{newJobsCount}</span>}
          </button>
        ))}
        <UserChip />
      </aside>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.filter((n) => n.mobile).map((n) => (
          <button
            key={n.to}
            className={active === n.key ? 'active' : ''}
            title={n.label}
            onClick={() => navigate(n.to)}
          >
            <n.Icon />
            {n.key === 'applications' && reviewCount > 0 && <span className="nav-dot" />}
            {n.key === 'jobs' && newJobsCount > 0 && <span className="nav-dot" />}
          </button>
        ))}
      </nav>
    </TgContext.Provider>
  )
}
