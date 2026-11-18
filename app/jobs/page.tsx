'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import JobDetailView from '@/components/career/JobDetailView'
import JobFilters, { EMPTY_FILTERS, activeCount, filterParams, filtersFromQuery } from '@/components/career/JobFilters'
import type { Filters } from '@/components/career/JobFilters'
import { ScorePill, StatusPill, timeAgo } from '@/components/career/ui'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { ClockIcon, LinkIcon, PinIcon } from '@/components/Icons'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { career } from '@/lib/career-api'
import type { JobFacets } from '@/lib/career-api'
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

/** Paste a posting's link: it joins your list, gets its description and a score, and can be applied to. */
function AddJobSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true)
    try {
      const r = await api.addJobByLink(url.trim())
      toast(r.existing ? 'That job is already in your list.' : 'Job added — fetching its description…', 'success')
      onAdded(r.job_id)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <form className="sheet" onSubmit={add} role="dialog" aria-label="Add a job by link">
        <div className="grabber" />
        <div className="sheet-head">
          <div>
            <h2>Add a job by link</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              A posting you found elsewhere — a company site, a Greenhouse or Lever link, a referral. It’s scored like
              every other job and you can apply to it from here.
            </p>
          </div>
        </div>
        <label className="field">
          <span className="lbl">Job posting URL</span>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/acme/jobs/123" />
        </label>
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !url.trim()}>{busy ? <span className="spin" /> : null} Add job</button>
        </div>
      </form>
    </>
  )
}

export default function JobsPage() {
  const [view, setView] = useState<string>('relevant')
  const [q, setQ] = useState('')
  const [filters, setFiltersState] = useState<Filters>(EMPTY_FILTERS)
  const [facets, setFacets] = useState<JobFacets | null>(null)
  const [sort, setSort] = useState('score')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ items: JobListItem[]; total: number } | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
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
    // Filters come from the address (/jobs?company=3 from Companies, or a bookmarked view).
    const sp = new URLSearchParams(window.location.search)
    setFiltersState(filtersFromQuery(sp))
    const v = sp.get('view')
    if (v && VIEWS.some(([k]) => k === v)) setView(v)
  }, [])

  const setFilters = (f: Filters) => {
    setFiltersState(f)
    setPage(0)
  }
  const fp = useMemo(() => filterParams(filters), [filters])
  const fpKey = JSON.stringify(fp)

  // Keep the address in step, so a filtered view can be bookmarked or shared.
  useEffect(() => {
    const sp = new URLSearchParams()
    if (view !== 'relevant') sp.set('view', view)
    for (const [k, v] of Object.entries(fp)) if (v !== undefined) sp.set(k, String(v))
    const next = `${window.location.pathname}${sp.toString() ? `?${sp}` : ''}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', next)
  }, [fpKey, view, fp])

  // Option counts for the filter panel.
  useEffect(() => {
    const t = setTimeout(() => {
      career.jobFacets({ view, q: q.trim() || undefined, ...fp }).then(setFacets).catch(() => setFacets(null))
    }, q ? 300 : 80)
    return () => clearTimeout(t)
  }, [view, q, fpKey, fp])

  const load = useCallback(() => {
    setErr(null)
    career
      .jobs({ view, q: q.trim() || undefined, sort, limit: PAGE, offset: page * PAGE, ...fp })
      .then((d) => {
        setData(d)
        if (desktop && d.items.length && !d.items.some((i) => i.id === selected)) setSelected(d.items[0].id)
      })
      .catch((e) => setErr((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, q, fpKey, sort, page, desktop])

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
      <PageHeader
        large
        title="Jobs"
        sub={data ? `${data.total} ${view === 'relevant' ? 'relevant to you' : 'jobs'} from ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}` : 'Loading…'}
        actions={<button className="btn" onClick={() => setAdding(true)}><LinkIcon /> Add a job by link</button>}
      />
      {adding && <AddJobSheet onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); navigate(`/jobs/${id}`) }} />}

      <div className="seg multi" style={{ marginBottom: 12 }}>
        {VIEWS.map(([k, label]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => { setView(k); setPage(0) }}>
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input type="search" placeholder="Search title, company, location…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="score">Best match</option>
          <option value="newest">Newest</option>
          <option value="company">Company</option>
        </select>
      </div>

      <JobFilters filters={filters} onChange={setFilters} facets={facets} total={data?.total ?? null} />

      {err && <div className="err-box">{err}</div>}

      <div className="jobs-layout">
        <div>
          {!data && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ marginBottom: 10 }} />)}
          {data && data.items.length === 0 && (
            <div className="empty">
              {companies.length === 0 ? (
                <>
                  No companies yet. <button className="link-btn" onClick={() => navigate('/companies')}>Add a career page</button>
                </>
              ) : activeCount(filters) > 0 ? (
                <>
                  No jobs match these filters. Remove one above, or{' '}
                  <button className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>clear all filters</button>.
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
                  <div className="meta" style={{ marginTop: 4 }}>
                    <span className="strong">{j.company_name}</span>
                    {j.location && (
                      <span>
                        <PinIcon />
                        {j.location.split(',')[0]}
                        {j.more_locations ? ` and ${j.more_locations} more` : ''}
                      </span>
                    )}
                    {j.match_breakdown?.experience_range && <span>{j.match_breakdown.experience_range.replace(' y', ' years')}</span>}
                    <span><ClockIcon />{timeAgo(j.posted_at || j.first_seen_at)}</span>
                  </div>
                  {j.match_breakdown && !j.match_breakdown.excluded && j.match_breakdown.skills_have.length > 0 && (
                    <div className="jc-why truncate">You have {j.match_breakdown.skills_have.slice(0, 5).join(', ')}</div>
                  )}
                  {j.match_breakdown?.excluded && <div className="jc-why">Filtered: {j.match_breakdown.excluded}</div>}
                  {(j.session_status || j.state === 'shortlisted' || j.state === 'new' || j.active === 0 || !j.has_description) && (
                    <div className="jc-tags">
                      {j.session_status && <StatusPill status={j.session_status} />}
                      {j.state === 'shortlisted' && <span className="pill warn">Shortlisted</span>}
                      {j.state === 'new' && <span className="pill info">New</span>}
                      {j.active === 0 && <span className="pill bad">Closed</span>}
                      {!j.has_description && <span className="pill">No description yet</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="pager">
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous page</button>
              <span className="muted small">Page {page + 1} of {pages}</span>
              <button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next page</button>
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
