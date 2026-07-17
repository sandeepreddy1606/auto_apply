import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { ToastProvider } from './Toast'
import Home from './pages/Home'
import Applications from './pages/Applications'
import Companies from './pages/Companies'
import Settings from './pages/Settings'
import IngestModal from './components/IngestModal'
import { GridIcon, ListIcon, ChatIcon, GearIcon, PlusSquare, BuildingIcon } from './components/Icons'

const TITLES = { home: 'Overview', applications: 'Applications', companies: 'Companies', settings: 'Settings' }

export default function App() {
  const [page, setPage] = useState('home')
  const [tg, setTg] = useState({ state: 'disconnected' })
  const [ingestOpen, setIngestOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [newJobsCount, setNewJobsCount] = useState(0)

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const [s, st, cj] = await Promise.all([
          api.tgStatus(), api.stats(),
          api.companyJobsSummary().catch(() => null),
        ])
        if (!alive) return
        setTg(s)
        setReviewCount(st.by_status?.review || 0)
        if (cj) setNewJobsCount(cj.new_matched || 0)
      } catch { /* backend warming up */ }
    }
    poll()
    const t = setInterval(poll, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [refreshKey])

  return (
    <ToastProvider>
      <div className="shell">
        <div className="header">
          <h1>{TITLES[page]}</h1>
          <div className="actions">
            <span className={`live-chip ${tg.state === 'connected' ? 'on' : ''}`}>
              <span className="pulse" />
              {tg.state === 'connected' ? 'Listening' : 'Offline'}
            </span>
            <button className="icon-btn" onClick={() => setIngestOpen(true)} title="Paste a message">
              <PlusSquare />
            </button>
          </div>
        </div>

        {page === 'home' && (
          <Home
            key={refreshKey}
            tg={tg}
            onOpenApps={() => setPage('applications')}
            onOpenSettings={() => setPage('settings')}
          />
        )}
        {page === 'applications' && <Applications key={refreshKey} />}
        {page === 'companies' && <Companies key={refreshKey} />}
        {page === 'settings' && <Settings tg={tg} setTg={setTg} />}
      </div>

      <nav className="bottom-nav">
        <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>
          <GridIcon />
        </button>
        <button className={page === 'applications' ? 'active' : ''} onClick={() => setPage('applications')}>
          <ListIcon />
          {reviewCount > 0 && <span className="nav-dot" />}
        </button>
        <button onClick={() => setIngestOpen(true)}>
          <ChatIcon />
        </button>
        <button className={page === 'companies' ? 'active' : ''} onClick={() => setPage('companies')}>
          <BuildingIcon />
          {newJobsCount > 0 && <span className="nav-dot" />}
        </button>
        <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>
          <GearIcon />
        </button>
      </nav>

      {ingestOpen && (
        <IngestModal
          onClose={() => setIngestOpen(false)}
          onDone={() => { setIngestOpen(false); setPage('applications'); refresh() }}
        />
      )}
    </ToastProvider>
  )
}
