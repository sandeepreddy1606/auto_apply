'use client'

/**
 * Client shell around every page: auth gate, toasts, guarded navigation, the
 * sidebar (laptop) / tab bar (phone) with live badges, and the Ctrl/⌘ K
 * command palette.
 */
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { api } from '@/lib/api'
import { career } from '@/lib/career-api'
import type { TelegramStatus } from '@/lib/types'

import { AuthProvider, isAuthRoute, useAuth } from './AuthProvider'
import CommandPalette from './CommandPalette'
import { BoltIcon, BriefcaseIcon, BuildingIcon, GearIcon, GridIcon, KanbanIcon, ListIcon, SearchIcon, SparkIcon } from './Icons'
import { NavigationProvider, useNavigate } from './Navigation'
import StaleGuard from './StaleGuard'
import { ThemeSwitch } from './Theme'
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

type NavKey = '' | 'jobs' | 'tracker' | 'claude-applications' | 'companies' | 'applications' | 'settings'
interface NavItem { key: NavKey; to: string; label: string; short: string; Icon: typeof GridIcon; mobile: boolean }

/** Grouped the way the work flows: find jobs → apply → set up. */
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Find',
    items: [
      { key: '', to: '/', label: 'Overview', short: 'Home', Icon: GridIcon, mobile: true },
      { key: 'jobs', to: '/jobs', label: 'Jobs', short: 'Jobs', Icon: BriefcaseIcon, mobile: true },
      { key: 'companies', to: '/companies', label: 'Companies', short: 'Companies', Icon: BuildingIcon, mobile: false },
    ],
  },
  {
    label: 'Apply',
    items: [
      { key: 'tracker', to: '/tracker', label: 'Applications', short: 'Applied', Icon: KanbanIcon, mobile: true },
      { key: 'claude-applications', to: '/claude-applications', label: 'Applications through Claude', short: 'Claude', Icon: SparkIcon, mobile: false },
      { key: 'applications', to: '/applications', label: 'Telegram inbox', short: 'Inbox', Icon: ListIcon, mobile: true },
    ],
  },
  {
    label: 'Setup',
    items: [{ key: 'settings', to: '/settings', label: 'Settings', short: 'Settings', Icon: GearIcon, mobile: true }],
  },
]
const NAV = GROUPS.flatMap((g) => g.items)

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <AuthProvider>
        <ToastProvider>
          <StaleGuard />
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

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <BoltIcon fill="currentColor" strokeWidth={0} />
    </span>
  )
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
  const [tg, setTg] = useState<TelegramStatus>({ state: 'disconnected', error: null, watched_chats: [] })
  const [reviewCount, setReviewCount] = useState(0)
  const [newJobsCount, setNewJobsCount] = useState(0)
  const [needsYou, setNeedsYou] = useState(0)
  const [palette, setPalette] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  // Ctrl/⌘ K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const [s, st, cj, sessions] = await Promise.all([
          api.tgStatus(),
          api.stats(),
          api.companyJobsSummary().catch(() => null),
          career.sessions().catch(() => null),
        ])
        if (!alive) return
        setTg(s)
        setReviewCount(st.by_status?.review || 0)
        if (cj) setNewJobsCount(cj.new_matched || 0)
        if (sessions) setNeedsYou(sessions.filter((x) => ['needs_input', 'blocked', 'unconfirmed', 'reviewing'].includes(x.status)).length)
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

  // '/' -> overview, '/applications/12' -> 'applications'; /apply/<sid> belongs to Applications.
  const root = pathname.split('/').filter(Boolean)[0] ?? ''
  const active = root === 'paste' ? '' : root === 'apply' ? 'tracker' : root

  const badge = (key: NavKey): { n: number; hot: boolean } | null => {
    if (key === 'jobs' && newJobsCount > 0) return { n: newJobsCount, hot: true }
    if (key === 'tracker' && needsYou > 0) return { n: needsYou, hot: true }
    if (key === 'applications' && reviewCount > 0) return { n: reviewCount, hot: false }
    return null
  }

  return (
    <TgContext.Provider value={{ tg, setTg }}>
      <div className="shell">
        <div className="mobile-top">
          <span className="brand"><BrandMark /> Auto Apply</span>
          <span className="mt-actions">
            <button className="icon-btn" onClick={() => setPalette(true)} aria-label="Search">
              <SearchIcon />
            </button>
          </span>
        </div>
        <div className="page" key={pathname}>
          {children}
        </div>
      </div>

      <aside className="sidebar" aria-label="Main">
        <div className="brand"><BrandMark /> Auto Apply</div>
        <button className="side-search" onClick={() => setPalette(true)}>
          <SearchIcon />
          <span>Search…</span>
          <kbd>Ctrl K</kbd>
        </button>
        {GROUPS.map((g) => (
          <nav className="side-group" key={g.label} aria-label={g.label}>
            <div className="side-label">{g.label}</div>
            {g.items.map((n) => {
              const b = badge(n.key)
              return (
                <button
                  key={n.to}
                  className={active === n.key ? 'side-link active' : 'side-link'}
                  aria-current={active === n.key ? 'page' : undefined}
                  onClick={() => navigate(n.to)}
                >
                  <n.Icon />
                  <span>{n.label}</span>
                  {b && <span className={`side-badge ${b.hot ? 'hot' : ''}`}>{b.n}</span>}
                </button>
              )
            })}
          </nav>
        ))}
        <div className="side-status">
          <div className="ss-row">
            <span className={`status-dot ${tg.state === 'connected' ? 'on' : ''}`} />
            <span>Telegram <b>{tg.state === 'connected' ? 'listening' : 'offline'}</b></span>
          </div>
          <div className="ss-row" style={{ justifyContent: 'space-between' }}>
            <span>Theme</span>
            <ThemeSwitch />
          </div>
        </div>
        <UserChip />
      </aside>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.filter((n) => n.mobile).map((n) => (
          <button
            key={n.to}
            className={active === n.key ? 'active' : ''}
            aria-current={active === n.key ? 'page' : undefined}
            onClick={() => navigate(n.to)}
          >
            <n.Icon />
            <span>{n.short}</span>
            {badge(n.key) && <span className="nav-dot" />}
          </button>
        ))}
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </TgContext.Provider>
  )
}
