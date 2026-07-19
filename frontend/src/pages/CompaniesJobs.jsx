import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { useToast } from '../Toast'
import PageHeader from '../components/PageHeader'
import CompaniesTabs from '../components/CompaniesTabs'
import { XIcon, CheckIcon } from '../components/Icons'

const timeAgo = (iso) => {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const VIEWS = [
  ['foryou', 'For you'],
  ['all', 'All'],
  ['applied', 'Applied'],
  ['dismissed', 'Dismissed'],
]
const PAGE = 60

const inView = (j, view) => {
  if (view === 'foryou') return j.matched === 1 && (j.state === 'new' || j.state === 'seen')
  if (view === 'all') return j.state !== 'dismissed'
  return j.state === view // applied | dismissed
}

export default function CompaniesJobs({ initialCompany }) {
  const [companies, setCompanies] = useState(null)
  const [jobs, setJobs] = useState(null) // ALL jobs; filtering is client-side & instant
  const [error, setError] = useState(null)
  const [view, setView] = useState('foryou')
  const [companyF, setCompanyF] = useState(initialCompany || 'all')
  const [locF, setLocF] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const toast = useToast()

  const loadCompanies = useCallback(() => {
    api.listCompanies().then(setCompanies).catch(() => {})
  }, [])

  const loadJobs = useCallback(() => {
    setError(null)
    api.listCompanyJobs({ view: 'everything' })
      .then(setJobs)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(loadCompanies, [loadCompanies])
  useEffect(loadJobs, [loadJobs])
  useEffect(() => { setLimit(PAGE) }, [view, companyF, locF, q])
  // Keep the company filter in sync with the ?company= deep-link even though
  // the page doesn't remount on a query-only hash change.
  useEffect(() => { setCompanyF(initialCompany || 'all') }, [initialCompany])

  // ----- derived data (all instant, no server round-trips) -----

  const counts = useMemo(() => {
    const c = { foryou: 0, all: 0, applied: 0, dismissed: 0 }
    for (const j of jobs || []) {
      for (const [id] of VIEWS) if (inView(j, id)) c[id] += 1
    }
    return c
  }, [jobs])

  const locations = useMemo(() => {
    const m = new Map()
    for (const j of jobs || []) {
      if (j.location) m.set(j.location, (m.get(j.location) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  }, [jobs])

  const filtered = useMemo(() => {
    let list = (jobs || []).filter((j) => inView(j, view))
    if (companyF !== 'all') list = list.filter((j) => String(j.company_id) === companyF)
    if (locF) list = list.filter((j) => (j.location || '') === locF)
    const s = q.trim().toLowerCase()
    if (s) {
      list = list.filter((j) =>
        `${j.title} ${j.company_name} ${j.location || ''}`.toLowerCase().includes(s))
    }
    return list
  }, [jobs, view, companyF, locF, q])

  const newTotal = useMemo(
    () => (jobs || []).filter((j) => j.matched === 1 && j.state === 'new').length,
    [jobs],
  )
  const hasFilters = companyF !== 'all' || locF || q.trim()

  // ----- actions -----

  const setJobState = async (job, state) => {
    setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, state } : j)))
    try {
      await api.patchCompanyJob(job.id, state)
    } catch (err) {
      toast(err.message, 'error')
      loadJobs()
    }
  }

  const markAllSeen = async () => {
    setJobs((js) => js.map((j) => (j.state === 'new' ? { ...j, state: 'seen' } : j)))
    try {
      await api.markCompanyJobsSeen()
    } catch (err) {
      toast(err.message, 'error')
      loadJobs()
    }
  }

  const openJob = (job) => {
    if (job.state === 'new') setJobState(job, 'seen')
  }

  return (
    <>
      <PageHeader large title="Companies"
        sub="Openings scanned from career pages you watch"
        actions={jobs?.some((j) => j.state === 'new') ? (
          <button className="btn sm" onClick={markAllSeen}>Mark all seen</button>
        ) : null} />

      <div className="settings-stack">
        <CompaniesTabs active="jobs" newCount={newTotal} companiesCount={companies?.length || 0} />

        <div className="card">
          <div className="chips" style={{ paddingBottom: 10 }}>
            {VIEWS.map(([id, label]) => (
              <button key={id} className={`chip ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
                {label} {counts[id] > 0 && <span className="chip-n">{counts[id]}</span>}
              </button>
            ))}
          </div>

          <div className="filters-row">
            <input placeholder="Search title, company, location…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="filters-selects">
              <select value={companyF} onChange={(e) => setCompanyF(e.target.value)}>
                <option value="all">All companies</option>
                {(companies || []).map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
              <select value={locF} onChange={(e) => setLocF(e.target.value)}>
                <option value="">Any location</option>
                {locations.map(([loc, n]) => (
                  <option key={loc} value={loc}>{loc} ({n})</option>
                ))}
              </select>
            </div>
            {hasFilters && (
              <button className="btn sm" onClick={() => { setQ(''); setCompanyF('all'); setLocF('') }}>
                Clear filters
              </button>
            )}
          </div>

          {error && jobs === null && (
            <div className="empty" style={{ padding: '30px 10px' }}>
              <p className="error-text" style={{ marginBottom: 12 }}>Couldn’t load openings: {error}</p>
              <button className="btn primary" onClick={loadJobs}>Retry</button>
            </div>
          )}
          {jobs === null && !error && <p className="muted">Loading…</p>}
          {jobs !== null && filtered.length === 0 && (
            <div className="empty" style={{ padding: '36px 10px' }}>
              {companies?.length === 0 ? (
                <>
                  <p style={{ marginBottom: 14 }}>You're not watching any companies yet.</p>
                  <button className="btn primary" onClick={() => navigate('/companies/manage')}>
                    Add your first company
                  </button>
                </>
              ) : hasFilters ? (
                <p>Nothing matches these filters.</p>
              ) : view === 'foryou' ? (
                <>
                  <p>No matching openings yet.</p>
                  <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                    They appear when a scan finds titles fitting your skills — try "All",
                    or widen the keywords in the Watched tab.
                  </p>
                </>
              ) : view === 'applied' ? (
                <p>Nothing marked applied yet — tick ✓ on a job once you've applied.</p>
              ) : view === 'dismissed' ? (
                <p>Nothing dismissed.</p>
              ) : (
                <p>No jobs scanned yet — run a scan from the Watched tab.</p>
              )}
            </div>
          )}

          {filtered.length > 0 && (
            <>
              <div className="job-list">
                {filtered.slice(0, limit).map((j) => (
                  <div key={j.id} className={`job-row ${j.state === 'new' ? 'is-new' : ''}`}>
                    <div className="j-body">
                      <a className="j-title" href={j.url} target="_blank" rel="noreferrer" onClick={() => openJob(j)}>
                        {j.title}
                      </a>
                      <div className="j-sub">
                        {j.company_name}
                        {j.location ? ` · ${j.location}` : ''}
                        {' · '}{timeAgo(j.first_seen_at)}
                        {j.matched === 1 && j.match_reason && <> · <span className="j-why">{j.match_reason}</span></>}
                        {j.matched === 0 && view !== 'foryou' && j.match_reason && <> · <span className="warn-text">{j.match_reason}</span></>}
                      </div>
                    </div>
                    {j.state === 'new' && <span className="badge email">new</span>}
                    {j.state === 'applied' && <span className="badge applied">applied</span>}
                    {j.state === 'applied' || j.state === 'dismissed' ? (
                      <button className="btn sm" title="Move back to the list" onClick={() => setJobState(j, 'seen')}>
                        Undo
                      </button>
                    ) : (
                      <>
                        <button className="icon-check" title="I applied to this job" onClick={() => setJobState(j, 'applied')}>
                          <CheckIcon style={{ width: 15, height: 15 }} />
                        </button>
                        <button className="icon-x" title="Dismiss — not interested" onClick={() => setJobState(j, 'dismissed')}>
                          <XIcon style={{ width: 15, height: 15 }} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {filtered.length > limit && (
                <button className="btn" style={{ width: '100%', marginTop: 10 }}
                  onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
