import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useToast } from '../Toast'
import { BuildingIcon, ListIcon, XIcon } from '../components/Icons'

const timeAgo = (iso) => {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const hostOf = (url) => {
  try { return new URL(url).host } catch { return url }
}

const VIEWS = [['matched', 'Matched'], ['all', 'All jobs'], ['dismissed', 'Dismissed']]

export default function Companies() {
  const [companies, setCompanies] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [view, setView] = useState('matched')
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState(new Set()) // company ids
  const [scanningAll, setScanningAll] = useState(false)
  const [keywords, setKeywords] = useState(null) // null until settings load
  const [profileHints, setProfileHints] = useState({ skills: '', role: '' })
  const [kwSaving, setKwSaving] = useState(false)
  const toast = useToast()

  const loadCompanies = useCallback(() => {
    api.listCompanies().then(setCompanies).catch((e) => toast(e.message, 'error'))
  }, [toast])

  const loadJobs = useCallback(() => {
    api.listCompanyJobs({ view, q }).then(setJobs).catch((e) => toast(e.message, 'error'))
  }, [view, q, toast])

  useEffect(loadCompanies, [loadCompanies])
  useEffect(() => {
    const t = setTimeout(loadJobs, q ? 250 : 0) // debounce search typing
    return () => clearTimeout(t)
  }, [loadJobs, q])

  useEffect(() => {
    api.getSettings().then((s) => {
      setKeywords(s.companies?.match_keywords || '')
      setProfileHints({ skills: s.profile?.skills || '', role: s.profile?.current_role || '' })
    }).catch(() => setKeywords(''))
  }, [])

  const refresh = () => { loadCompanies(); loadJobs() }

  const setBusy = (id, on) => setScanning((prev) => {
    const next = new Set(prev)
    if (on) next.add(id); else next.delete(id)
    return next
  })

  const addCompany = async (e) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) {
      toast('Enter both a company name and its careers page URL.', 'error')
      return
    }
    setAdding(true)
    try {
      const created = await api.addCompany(name.trim(), url.trim())
      setName(''); setUrl('')
      loadCompanies()
      toast(`${created.name} added — scanning now…`, 'success')
      await scanOne(created, { silent: false })
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setAdding(false)
    }
  }

  const scanOne = async (company, { silent } = { silent: false }) => {
    setBusy(company.id, true)
    try {
      const { result } = await api.scanCompany(company.id)
      if (!silent) {
        toast(result.found === 0
          ? `${company.name}: no job links found — see the note on the company row.`
          : `${company.name}: ${result.found} jobs, ${result.matched} match your profile (${result.new} new).`,
          result.found === 0 ? 'error' : 'success')
      }
    } catch (err) {
      toast(`${company.name}: ${err.message}`, 'error')
    } finally {
      setBusy(company.id, false)
      refresh()
    }
  }

  const scanAll = async () => {
    if (!companies?.length) return
    setScanningAll(true)
    try {
      await api.scanAllCompanies()
      toast(`Scanning ${companies.length} compan${companies.length > 1 ? 'ies' : 'y'} in the background…`)
      // results trickle in; refresh a couple of times
      setTimeout(refresh, 6000)
      setTimeout(refresh, 20000)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setScanningAll(false)
    }
  }

  const removeCompany = async (company) => {
    if (!window.confirm(`Remove ${company.name} and all its scanned jobs?`)) return
    try {
      await api.deleteCompany(company.id)
      toast(`${company.name} removed.`)
      refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const saveKeywords = async () => {
    setKwSaving(true)
    try {
      await api.saveSettings({ companies: { match_keywords: keywords } })
      toast('Keywords saved — rescanning to re-match jobs…', 'success')
      scanAll()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setKwSaving(false)
    }
  }

  const setJobState = async (job, state) => {
    // optimistic update
    setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, state } : j)))
    try {
      await api.patchCompanyJob(job.id, state)
      if (state === 'dismissed' || view === 'dismissed') loadJobs()
      loadCompanies()
    } catch (err) {
      toast(err.message, 'error')
      loadJobs()
    }
  }

  const markAllSeen = async () => {
    try {
      await api.markCompanyJobsSeen()
      refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const openJob = (job) => {
    if (job.state === 'new') setJobState(job, 'seen')
  }

  const noKeywords = keywords !== null && !keywords.trim() && !profileHints.skills.trim() && !profileHints.role.trim()
  const newCount = useMemo(() => (jobs || []).filter((j) => j.state === 'new').length, [jobs])

  return (
    <div className="settings-stack">
      <div className="card">
        <h3><BuildingIcon style={{ width: 18, height: 18 }} /> Companies you're watching</h3>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          Add a company and its careers page — new openings are scanned automatically and the
          ones matching your skills show up below. These stay separate from your message inbox.
          Job-board links (Greenhouse, Lever, Workable, Ashby…) work best.
        </p>

        <form onSubmit={addCompany} className="grid-2" style={{ alignItems: 'end' }}>
          <label className="field">
            <span className="lbl">Company name</span>
            <input value={name} placeholder="e.g. Stripe" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="lbl">Careers page URL</span>
            <input value={url} placeholder="e.g. stripe.com/jobs or boards.greenhouse.io/…"
              onChange={(e) => setUrl(e.target.value)} />
          </label>
        </form>
        <div className="row-actions">
          <button className="btn primary" disabled={adding} onClick={addCompany}>
            {adding ? 'Adding & scanning…' : 'Add company'}
          </button>
          {companies?.length > 0 && (
            <button className="btn sm" disabled={scanningAll} onClick={scanAll}>
              {scanningAll ? 'Starting…' : 'Scan all now'}
            </button>
          )}
        </div>

        {companies === null && <p className="muted" style={{ marginTop: 14 }}>Loading…</p>}
        {companies?.length === 0 && (
          <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
            No companies yet — add your first one above.
          </p>
        )}
        {companies?.length > 0 && (
          <div className="company-list">
            {companies.map((c) => (
              <div key={c.id} className="company-row">
                <div className="c-main">
                  <div className="c-name">{c.name}</div>
                  <div className="c-sub">
                    <a href={c.career_url} target="_blank" rel="noreferrer">{hostOf(c.career_url)}</a>
                    {' · '}scanned {timeAgo(c.last_scanned_at)}
                    {c.last_status === 'ok' && <> · {c.jobs_found} jobs, <strong style={{ color: 'var(--text)' }}>{c.matched_jobs} matched</strong></>}
                  </div>
                  {c.last_status === 'error' && <div className="error-text" style={{ marginTop: 4 }}>⚠ {c.last_error}</div>}
                  {c.last_status === 'empty' && <div className="warn-text" style={{ marginTop: 4 }}>{c.last_error}</div>}
                </div>
                {c.new_jobs > 0 && <span className="badge review">{c.new_jobs} new</span>}
                <button className="btn sm" disabled={scanning.has(c.id)} onClick={() => scanOne(c)}>
                  {scanning.has(c.id) ? 'Scanning…' : 'Scan'}
                </button>
                <button className="icon-x" title="Remove company" onClick={() => removeCompany(c)}>
                  <XIcon style={{ width: 15, height: 15 }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3><ListIcon style={{ width: 18, height: 18 }} /> Matching</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Jobs are matched against your profile skills{profileHints.role ? <> and role (<strong>{profileHints.role}</strong>)</> : ''},
          with a seniority check against your experience. Add extra keywords here to widen or steer the match.
        </p>
        {noKeywords && (
          <p className="warn-text" style={{ marginBottom: 12 }}>
            No skills, role or keywords set — nothing will match. Fill your profile in Settings or add keywords below.
          </p>
        )}
        <div className="row-actions" style={{ marginTop: 0 }}>
          <input placeholder="Extra keywords, comma separated (e.g. react, node, fullstack)"
            value={keywords ?? ''} onChange={(e) => setKeywords(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn sm primary" disabled={kwSaving || keywords === null} onClick={saveKeywords}>
            {kwSaving ? 'Saving…' : 'Save & re-match'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3><ListIcon style={{ width: 18, height: 18 }} /> Openings for you</h3>
        <div className="chips" style={{ paddingBottom: 10 }}>
          {VIEWS.map(([id, label]) => (
            <button key={id} className={`chip ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
          {newCount > 0 && view !== 'dismissed' && (
            <button className="chip" onClick={markAllSeen}>Mark all seen</button>
          )}
        </div>
        <div className="search-wrap">
          <input placeholder="Search title, company, location…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {jobs === null && <p className="muted">Loading…</p>}
        {jobs?.length === 0 && (
          <p className="empty" style={{ padding: '30px 10px' }}>
            {view === 'matched'
              ? 'No matching openings yet. They\'ll appear here after a scan finds titles that fit your skills.'
              : view === 'dismissed' ? 'Nothing dismissed.' : 'No jobs scanned yet.'}
          </p>
        )}
        {jobs?.length > 0 && (
          <div className="job-list">
            {jobs.map((j) => (
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
                    {j.matched === 0 && view !== 'matched' && j.match_reason && <> · <span className="warn-text">{j.match_reason}</span></>}
                  </div>
                </div>
                {j.state === 'new' && <span className="badge email">new</span>}
                {view === 'dismissed' ? (
                  <button className="btn sm" onClick={() => setJobState(j, 'seen')}>Restore</button>
                ) : (
                  <button className="icon-x" title="Dismiss — hide this job" onClick={() => setJobState(j, 'dismissed')}>
                    <XIcon style={{ width: 15, height: 15 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
