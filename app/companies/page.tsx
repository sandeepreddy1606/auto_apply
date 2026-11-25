'use client'

/**
 * Companies: the career pages you watch. Each row shows its live scan state,
 * what it found, when it's scanned next, and what went wrong. Openings
 * themselves live in Jobs (one list, one definition of "relevant"):
 * "View jobs" opens it filtered to the company.
 */
import { useCallback, useEffect, useState } from 'react'

import { BuildingIcon, ChevronRight, XIcon } from '@/components/Icons'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { api, request } from '@/lib/api'
import type { CompaniesConfig, Company } from '@/lib/types'
import { platformLabel } from '@/lib/companies/names'
import SuggestedCompanies from '@/components/career/SuggestedCompanies'
import Monogram from '@/components/career/Monogram'

const INTERVALS: [number, string][] = [
  [60, 'every hour'],
  [180, 'every 3 hours'],
  [360, 'every 6 hours'],
  [720, 'every 12 hours'],
  [1440, 'once a day'],
]

function rel(iso: string | null | undefined, future = false): string {
  if (!iso) return future ? 'soon' : 'never'
  const d = (Date.parse(iso) - Date.now()) / 1000
  const s = Math.abs(d)
  const txt = s < 60 ? 'a moment' : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`
  if (future) return d <= 0 ? 'soon' : `in ${txt}`
  return s < 60 ? 'just now' : `${txt} ago`
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Status({ c, everyMin }: { c: Company; everyMin: number }) {
  // Companies scanned before scheduling existed have no stored next time yet.
  const next = c.next_scan_at ?? (c.last_scanned_at ? new Date(Date.parse(c.last_scanned_at) + everyMin * 60_000).toISOString() : null)
  if (c.scan_state === 'scanning') return <span className="cstat run"><span className="spin" /> Scanning…</span>
  if (c.scan_state === 'queued') return <span className="cstat run"><span className="spin" /> Waiting to scan…</span>
  if (c.paused) return <span className="cstat">Paused, last scanned {rel(c.last_scanned_at)}</span>
  if (c.last_status === 'error') {
    return (
      <span className="cstat bad">
        Scan failed {rel(c.last_scanned_at)}{(c.fail_count ?? 0) > 1 ? ` (${c.fail_count} times in a row)` : ''}, retrying {rel(next, true)}
      </span>
    )
  }
  if (c.last_status === 'empty') return <span className="cstat warn">No openings found {rel(c.last_scanned_at)}, next scan {rel(next, true)}</span>
  if (!c.last_scanned_at) return <span className="cstat">Not scanned yet</span>
  return <span className="cstat ok">Scanned {rel(c.last_scanned_at)}, next {rel(next, true)}</span>
}

function CompanyRow({ c, onChanged, everyMin }: { c: Company; onChanged: () => void; everyMin: number }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [url, setUrl] = useState(c.career_url)
  const busy = Boolean(c.scan_state)

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast(ok, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      onChanged()
    }
  }
  const remove = () => {
    if (!window.confirm(`Remove ${c.name} and its ${c.active_jobs ?? 0} scanned jobs?`)) return
    void run(() => api.deleteCompany(c.id), `${c.name} removed.`)
  }
  const save = () =>
    run(async () => {
      await api.updateCompany(c.id, { name, career_url: url })
      setEditing(false)
    }, 'Saved.')

  return (
    <div className="crow">
      <div className="crow-main">
        <Monogram name={c.name} />
        <div style={{ minWidth: 0, flex: 1 }}>
          {editing ? (
            <div className="grid-2" style={{ gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Company name" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Careers page URL" />
            </div>
          ) : (
            <>
              <div className="crow-title">
                {c.name}
                {platformLabel(c.ats_type, c.name) && <span className="pill">{platformLabel(c.ats_type, c.name)}</span>}
                {c.priority === 'high' && <span className="pill info">High priority</span>}
                {c.priority === 'low' && <span className="pill">Low priority</span>}
              </div>
              <div className="crow-sub">
                <a href={c.career_url} target="_blank" rel="noreferrer">{hostOf(c.career_url)} ↗</a>&nbsp;&nbsp;<Status c={c} everyMin={everyMin} />
              </div>
            </>
          )}
          {!editing && c.last_status !== 'ok' && c.last_error && <div className={`crow-err ${c.last_status === 'error' ? 'bad' : 'warn'}`}>{c.last_error}</div>}
        </div>
      </div>

      {!editing && (
        <div className="crow-stats">
          <button className="cnum" onClick={() => navigate(`/jobs?company=${c.id}&view=all`)} title="All open jobs at this company">
            <b>{c.active_jobs ?? 0}</b> open
          </button>
          <button className="cnum" onClick={() => navigate(`/jobs?company=${c.id}`)} title="Jobs relevant to you">
            <b>{c.matched_jobs ?? 0}</b> relevant
          </button>
          {(c.new_jobs ?? 0) > 0 && <span className="pill info">{c.new_jobs} new</span>}
          {(c.submitted ?? 0) > 0 && <span className="pill ok">{c.submitted} applied</span>}
          {(c.applications ?? 0) - (c.submitted ?? 0) > 0 && <span className="pill">{(c.applications ?? 0) - (c.submitted ?? 0)} in progress</span>}
        </div>
      )}

      <div className="crow-actions">
        {editing ? (
          <>
            <button className="btn sm" onClick={() => { setEditing(false); setName(c.name); setUrl(c.career_url) }}>Cancel</button>
            <button className="btn sm primary" onClick={save}>Save</button>
          </>
        ) : (
          <>
            <button className="btn sm primary" onClick={() => navigate(`/jobs?company=${c.id}`)}>View jobs <ChevronRight /></button>
            <button className="btn sm" disabled={busy} onClick={() => run(() => api.scanCompany(c.id))}>{busy ? 'Scanning…' : 'Scan now'}</button>
            <button className="btn sm" onClick={() => run(() => api.updateCompany(c.id, { paused: !c.paused }), c.paused ? 'Scanning resumed.' : 'Paused — it won’t be scanned automatically.')}>
              {c.paused ? 'Resume' : 'Pause'}
            </button>
            <select
              aria-label="Priority"
              value={c.priority ?? 'normal'}
              onChange={(e) => run(() => api.updateCompany(c.id, { priority: e.target.value }))}
              style={{ width: 'auto', minHeight: 30, height: 30, fontSize: 12.5, padding: '0 28px 0 10px' }}
            >
              <option value="high">High priority</option>
              <option value="normal">Normal priority</option>
              <option value="low">Low priority</option>
            </select>
            <button className="btn sm ghost" onClick={() => setEditing(true)}>Edit</button>
            <button className="icon-x" title="Remove company" aria-label={`Remove ${c.name}`} onClick={remove}>
              <XIcon style={{ width: 14, height: 14 }} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function CompaniesPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [cfg, setCfg] = useState<CompaniesConfig | null>(null)
  const [prefs, setPrefs] = useState<{ roles: string[]; locations: string[] }>({ roles: [], locations: [] })

  const load = useCallback(() => {
    api
      .listCompanies()
      .then((l) => {
        setCompanies(l)
        setLoadErr(null)
      })
      .catch((e) => setLoadErr((e as Error).message))
  }, [])
  useEffect(load, [load])

  // While anything is queued or scanning, keep the rows live.
  const active = companies?.some((c) => c.scan_state) ?? false
  useEffect(() => {
    const t = setInterval(load, active ? 3000 : 30000)
    return () => clearInterval(t)
  }, [active, load])

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setCfg({ match_keywords: s.companies?.match_keywords || '', scan_interval_minutes: s.companies?.scan_interval_minutes || 180, auto_scan: s.companies?.auto_scan !== false })
        setPrefs({ roles: s.job_prefs?.target_roles || [], locations: s.job_prefs?.locations || [] })
      })
      .catch(() => setCfg({ match_keywords: '', scan_interval_minutes: 180, auto_scan: true }))
  }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return toast('Enter the company name and its careers page URL.', 'error')
    setAdding(true)
    try {
      const c = await api.addCompany(name.trim(), url.trim())
      setName('')
      setUrl('')
      toast(`${c.name} added — scanning now. Its openings will appear in Jobs.`, 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setAdding(false)
    }
  }

  const scanAll = async () => {
    try {
      const r = await api.scanAllCompanies()
      toast(`Scanning ${r.started} compan${r.started === 1 ? 'y' : 'ies'}…`)
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const saveCfg = async () => {
    if (!cfg) return
    try {
      await api.saveSettings({ companies: cfg })
      toast('Saved.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const rescore = async () => {
    try {
      await request('/api/jobs/rescore', { method: 'POST' })
      toast('Re-scoring every job against your preferences and resume…', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const totals = (companies ?? []).reduce((a, c) => ({ open: a.open + (c.active_jobs ?? 0), rel: a.rel + (c.matched_jobs ?? 0), fails: a.fails + (c.last_status === 'error' ? 1 : 0) }), { open: 0, rel: 0, fails: 0 })

  return (
    <>
      <PageHeader
        large
        title="Companies"
        sub={companies ? `${companies.length} career page${companies.length === 1 ? '' : 's'} with ${totals.open} open jobs, ${totals.rel} relevant to you` : 'Career pages you watch'}
        actions={companies && companies.length > 0 ? <button className="btn" onClick={scanAll}>Scan all</button> : undefined}
      />

      <div className="settings-stack">
        <form className="card" onSubmit={add}>
          <h3><BuildingIcon style={{ width: 17, height: 17 }} /> Watch a careers page</h3>
          <div className="add-company">
            <input value={name} placeholder="Company name, e.g. Stripe" onChange={(e) => setName(e.target.value)} aria-label="Company name" />
            <input value={url} placeholder="Careers page URL, e.g. boards.greenhouse.io/stripe" onChange={(e) => setUrl(e.target.value)} aria-label="Careers page URL" />
            <button className="btn primary" disabled={adding}>{adding ? <span className="spin" /> : null} Add & scan</button>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Works with Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee and Workday boards, Amazon, Google and Microsoft careers,
            and most company job pages. Found a single job instead? <button type="button" className="link-btn" onClick={() => navigate('/jobs')}>Add it by link in Jobs</button>.
          </p>
        </form>

        {companies && <SuggestedCompanies companies={companies} onAdded={load} />}

        {loadErr && !companies && (
          <div className="err-box">Couldn’t load companies: {loadErr} <button className="link-btn" onClick={load}>Retry</button></div>
        )}
        {!companies && !loadErr && <div className="skeleton" style={{ height: 160 }} />}
        {companies && companies.length === 0 && (
          <div className="card empty-state">
            <span className="es-icon"><BuildingIcon /></span>
            <b>No companies yet</b>
            <p>Add a careers page above. It’s scanned now and then on a schedule, and matching openings show up in Jobs.</p>
          </div>
        )}
        {companies && companies.length > 0 && (
          <div className="company-cards">
            {totals.fails > 0 && <div className="warn-box">{totals.fails} compan{totals.fails === 1 ? 'y' : 'ies'} failed to scan — see the message on the row. Failed scans retry automatically, waiting longer each time.</div>}
            {companies.map((c) => <CompanyRow key={c.id} c={c} onChanged={load} everyMin={cfg?.scan_interval_minutes ?? 180} />)}
          </div>
        )}

        <div className="card">
          <h3>Scanning & matching</h3>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Every job is scored against your Job preferences and your resume. Amazon, Google and Microsoft are searched with your target roles and
            locations{prefs.roles.length ? <> (<b>{prefs.roles.join(', ')}</b>{prefs.locations.length ? <> in {prefs.locations.join(', ')}</> : null})</> : null}.{' '}
            {!prefs.roles.length && <span className="warn-text">No target roles set — matching uses the titles on your resume. </span>}
            <button className="link-btn" onClick={() => navigate('/settings/preferences')}>{prefs.roles.length ? 'Change preferences' : 'Set roles & locations'}</button>
          </p>
          {cfg && (
            <div className="grid-2" style={{ alignItems: 'end' }}>
              <label className="field">
                <span className="lbl">Scan each company</span>
                <select value={String(cfg.scan_interval_minutes)} onChange={(e) => setCfg({ ...cfg, scan_interval_minutes: Number(e.target.value) })}>
                  {INTERVALS.map(([m, label]) => <option key={m} value={String(m)}>{label}</option>)}
                </select>
              </label>
              <label className="toggle" style={{ paddingBottom: 10 }}>
                <input type="checkbox" checked={cfg.auto_scan} onChange={(e) => setCfg({ ...cfg, auto_scan: e.target.checked })} />
                <span>Scan automatically in the background</span>
              </label>
            </div>
          )}
          <div className="row-actions">
            <button className="btn sm primary" onClick={saveCfg}>Save schedule</button>
            <button className="btn sm" onClick={rescore} title="No scanning: re-scores the jobs you already have">Re-score all jobs</button>
          </div>
        </div>
      </div>
    </>
  )
}
