'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import JobDetailView from '@/components/career/JobDetailView'
import { ScorePill, StatusPill, timeAgo } from '@/components/career/ui'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { api } from '@/lib/api'
import { career } from '@/lib/career-api'
import type { Company, JobListItem } from '@/lib/types'

const VIEWS = [
  ['relevant', 'Relevant'],
  ['all', 'All jobs'],
  ['shortlisted', 'Shortlisted'],
  ['applied', 'Applied'],
  ['dismissed', 'Dismissed'],
] as const
const PAGE = 50

function useIsDesktop() {
  const [d, setD] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setD(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return d
}

export default function JobsPage() {
  const [view, setView] = useState<string>('relevant')
  const [q, setQ] = useState('')
  const [company, setCompany] = useState<number | null>(null)
  const [sort, setSort] = useState('score')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ items: JobListItem[]; total: number } | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const desktop = useIsDesktop()
  const navigate = useNavigate()

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch(() => {})
    try {
      const saved = JSON.parse(localStorage.getItem('aa_jobs_filters') || '{}') as { view?: string; sort?: string }
      if (saved.view) setView(saved.view)
      if (saved.sort) setSort(saved.sort)
    } catch {
      /* fresh start */
    }
  }, [])

  const load = useCallback(() => {
    setErr(null)
    career
      .jobs({ view, q: q.trim() || undefined, company, sort, limit: PAGE, offset: page * PAGE })
      .then((d) => {
        setData(d)
        if (desktop && d.items.length && !d.items.some((i) => i.id === selected)) setSelected(d.items[0].id)
      })
      .catch((e) => setErr((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, q, company, sort, page, desktop])

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  useEffect(() => {
    try {
      localStorage.setItem('aa_jobs_filters', JSON.stringify({ view, sort }))
    } catch {
      /* private mode */
    }
  }, [view, sort])

  // Keyboard: j/k to move, Enter/a to open.
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      const items = data?.items ?? []
      const i = items.findIndex((x) => x.id === selected)
      if (e.key === 'j' && i < items.length - 1) setSelected(items[i + 1].id)
      if (e.key === 'k' && i > 0) setSelected(items[i - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [desktop, data, selected])

  const open = (j: JobListItem) => (desktop ? setSelected(j.id) : navigate(`/jobs/${j.id}`))
  const pages = useMemo(() => Math.ceil((data?.total ?? 0) / PAGE), [data])

  return (
    <div className="wide">
      <PageHeader large title="Jobs" sub={data ? `${data.total} ${view === 'relevant' ? 'relevant to you' : 'jobs'} · from ${companies.length} companies` : 'Loading…'} />

      <div className="seg multi" style={{ marginBottom: 12 }}>
        {VIEWS.map(([k, label]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => { setView(k); setPage(0) }}>
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input type="search" placeholder="Search title, company, location…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
        <select value={company ?? ''} onChange={(e) => { setCompany(e.target.value ? Number(e.target.value) : null); setPage(0) }}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score">Best match</option>
          <option value="newest">Newest</option>
          <option value="company">Company</option>
        </select>
      </div>

      {err && <div className="err-box">{err}</div>}

      <div className="jobs-layout">
        <div>
          {!data && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ marginBottom: 10 }} />)}
          {data && data.items.length === 0 && (
            <div className="empty">
              {companies.length === 0 ? (
                <>
                  No companies yet. <button className="link-btn" onClick={() => navigate('/companies/manage')}>Add career pages →</button>
                </>
              ) : view === 'relevant' ? (
                <>
                  Nothing above your relevance threshold.{' '}
                  <button className="link-btn" onClick={() => setView('all')}>See all jobs</button> or{' '}
                  <button className="link-btn" onClick={() => navigate('/settings/preferences')}>tune preferences</button>.
                </>
              ) : (
                'No jobs here.'
              )}
            </div>
          )}
          <div className="job-cards">
            {data?.items.map((j) => (
              <div key={j.id} className={`job-card ${selected === j.id && desktop ? 'selected' : ''}`} onClick={() => open(j)}>
                <ScorePill score={j.match_score} breakdown={j.match_breakdown} />
                <div style={{ minWidth: 0 }}>
                  <div className="jc-title">{j.title}</div>
                  <div className="jc-meta truncate">
                    {j.company_name}
                    {j.location ? ` · ${j.location}` : ''} · {timeAgo(j.posted_at || j.first_seen_at)}
                  </div>
                  {j.match_breakdown && !j.match_breakdown.excluded && j.match_breakdown.skills_have.length > 0 && (
                    <div className="jc-why truncate">✓ {j.match_breakdown.skills_have.slice(0, 6).join(' · ')}</div>
                  )}
                  {j.match_breakdown?.excluded && <div className="jc-why">Filtered: {j.match_breakdown.excluded}</div>}
                  <div className="jc-tags">
                    {j.session_status && <StatusPill status={j.session_status} />}
                    {j.state === 'shortlisted' && <span className="pill warn">★ Shortlisted</span>}
                    {j.state === 'new' && <span className="pill info">New</span>}
                    {!j.has_description && <span className="pill">No description yet</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="pager">
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
              <span className="muted small">Page {page + 1} of {pages}</span>
              <button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
          {desktop && <p className="muted small" style={{ textAlign: 'center' }}>Tip: j / k to move between jobs</p>}
        </div>
        {desktop && (
          <div className="detail-pane">
            {selected ? <JobDetailView id={selected} onChanged={load} /> : <div className="empty">Pick a job</div>}
          </div>
        )}
      </div>
    </div>
  )
}
