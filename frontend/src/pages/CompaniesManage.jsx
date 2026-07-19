import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { useToast } from '../Toast'
import PageHeader from '../components/PageHeader'
import CompaniesTabs from '../components/CompaniesTabs'
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

const INTERVALS = [
  [60, 'every hour'], [180, 'every 3 hours'], [360, 'every 6 hours'],
  [720, 'every 12 hours'], [1440, 'once a day'],
]

export default function CompaniesManage() {
  const [companies, setCompanies] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [newTotal, setNewTotal] = useState(0)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState(new Set())
  const [scanningAll, setScanningAll] = useState(false)
  const [cfg, setCfg] = useState(null) // {match_keywords, scan_interval_minutes, auto_scan}
  const [profileHints, setProfileHints] = useState({ skills: '', role: '' })
  const [cfgSaving, setCfgSaving] = useState(false)
  const toast = useToast()

  const load = useCallback(() => {
    setLoadErr(null)
    api.listCompanies().then((list) => {
      setCompanies(list)
      setNewTotal(list.reduce((a, c) => a + (c.new_jobs || 0), 0))
    }).catch((e) => setLoadErr(e.message))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    api.getSettings().then((s) => {
      setCfg({
        match_keywords: s.companies?.match_keywords || '',
        scan_interval_minutes: s.companies?.scan_interval_minutes || 180,
        auto_scan: s.companies?.auto_scan !== false,
      })
      setProfileHints({ skills: s.profile?.skills || '', role: s.profile?.current_role || '' })
    }).catch(() => setCfg({ match_keywords: '', scan_interval_minutes: 180, auto_scan: true }))
  }, [])

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
      load()
      toast(`${created.name} added — scanning now…`, 'success')
      await scanOne(created)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setAdding(false)
    }
  }

  const scanOne = async (company) => {
    setBusy(company.id, true)
    try {
      const { result } = await api.scanCompany(company.id)
      toast(result.found === 0
        ? `${company.name}: no job links found — see the note on the company row.`
        : `${company.name}: ${result.found} jobs, ${result.matched} match your profile (${result.new} new).`,
        result.found === 0 ? 'error' : 'success')
    } catch (err) {
      toast(`${company.name}: ${err.message}`, 'error')
    } finally {
      setBusy(company.id, false)
      load()
    }
  }

  const scanAll = async () => {
    if (!companies?.length) return
    setScanningAll(true)
    try {
      await api.scanAllCompanies()
      toast(`Scanning ${companies.length} compan${companies.length > 1 ? 'ies' : 'y'} in the background…`)
      setTimeout(load, 6000)
      setTimeout(load, 20000)
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
      load()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const saveCfg = async () => {
    setCfgSaving(true)
    try {
      await api.saveSettings({ companies: cfg })
      toast('Scan settings saved — rescanning to re-match jobs…', 'success')
      scanAll()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setCfgSaving(false)
    }
  }

  const noKeywords = cfg !== null && !cfg.match_keywords.trim()
    && !profileHints.skills.trim() && !profileHints.role.trim()

  return (
    <>
      <PageHeader large title="Companies"
        sub="Watch career pages — matching openings appear under Openings" />

      <div className="settings-stack">
        <CompaniesTabs active="manage" newCount={newTotal} companiesCount={companies?.length || 0} />

        <div className="card">
          <h3><BuildingIcon style={{ width: 18, height: 18 }} /> Add a company</h3>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            Paste a careers page URL. Job-board links (Greenhouse, Lever, Workable, Ashby…) work best.
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
              {adding ? 'Adding & scanning…' : 'Add & scan'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="jobs-head">
            <h3 style={{ marginBottom: 0 }}><BuildingIcon style={{ width: 18, height: 18 }} /> Watched companies</h3>
            {companies?.length > 0 && (
              <button className="btn sm" disabled={scanningAll} onClick={scanAll}>
                {scanningAll ? 'Starting…' : 'Scan all now'}
              </button>
            )}
          </div>
          {loadErr && companies === null && (
            <div style={{ marginTop: 14 }}>
              <p className="error-text" style={{ marginBottom: 10 }}>Couldn’t load companies: {loadErr}</p>
              <button className="btn sm primary" onClick={load}>Retry</button>
            </div>
          )}
          {companies === null && !loadErr && <p className="muted" style={{ marginTop: 14 }}>Loading…</p>}
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
                  {c.new_jobs > 0 && (
                    <button className="badge review" style={{ border: 'none', cursor: 'pointer' }}
                      title="Show these new openings"
                      onClick={() => navigate(`/companies?company=${c.id}`)}>
                      {c.new_jobs} new
                    </button>
                  )}
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
          <h3><ListIcon style={{ width: 18, height: 18 }} /> Matching & scanning</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Jobs are matched against your profile skills{profileHints.role ? <> and role (<strong>{profileHints.role}</strong>)</> : ''},
            with a seniority check against your experience. Add extra keywords to widen or steer the match.
          </p>
          {noKeywords && (
            <p className="warn-text" style={{ marginBottom: 12 }}>
              No skills, role or keywords set — nothing will match.{' '}
              <a onClick={() => navigate('/settings/profile')} style={{ cursor: 'pointer' }}>Fill your profile</a>{' '}
              or add keywords below.
            </p>
          )}
          {cfg && (
            <div className="stack">
              <label className="field">
                <span className="lbl">Extra match keywords (comma separated)</span>
                <input placeholder="e.g. react, node, fullstack"
                  value={cfg.match_keywords}
                  onChange={(e) => setCfg((c) => ({ ...c, match_keywords: e.target.value }))} />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span className="lbl">Auto-scan schedule</span>
                  <select value={String(cfg.scan_interval_minutes)}
                    onChange={(e) => setCfg((c) => ({ ...c, scan_interval_minutes: Number(e.target.value) }))}>
                    {INTERVALS.map(([m, label]) => (
                      <option key={m} value={String(m)}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="toggle" style={{ alignSelf: 'end', paddingBottom: 12 }}>
                  <input type="checkbox" checked={cfg.auto_scan}
                    onChange={(e) => setCfg((c) => ({ ...c, auto_scan: e.target.checked }))} />
                  <span>Scan automatically in the background</span>
                </label>
              </div>
              <div className="row-actions" style={{ marginTop: 0 }}>
                <button className="btn sm primary" disabled={cfgSaving} onClick={saveCfg}>
                  {cfgSaving ? 'Saving…' : 'Save & re-match'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
