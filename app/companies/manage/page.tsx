'use client'

import { useCallback, useEffect, useState } from 'react'

import CompaniesTabs from '@/components/CompaniesTabs'
import { BuildingIcon, ListIcon, XIcon } from '@/components/Icons'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { career } from '@/lib/career-api'
import type { CompaniesConfig, Company } from '@/lib/types'

const timeAgo = (iso: string | null): string => {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const INTERVALS: [number, string][] = [
  [60, 'every hour'],
  [180, 'every 3 hours'],
  [360, 'every 6 hours'],
  [720, 'every 12 hours'],
  [1440, 'once a day'],
]

export default function CompaniesManagePage() {
  const navigate = useNavigate()
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [newTotal, setNewTotal] = useState(0)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState<Set<number>>(new Set())
  const [scanningAll, setScanningAll] = useState(false)
  const [cfg, setCfg] = useState<CompaniesConfig | null>(null)
  const [prefsHint, setPrefsHint] = useState<{ roles: string[]; locations: string[] }>({ roles: [], locations: [] })
  const [cfgSaving, setCfgSaving] = useState(false)
  const toast = useToast()

  const load = useCallback(() => {
    setLoadErr(null)
    api
      .listCompanies()
      .then((list) => {
        setCompanies(list)
        setNewTotal(list.reduce((a, c) => a + (c.new_jobs || 0), 0))
      })
      .catch((e) => setLoadErr((e as Error).message))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setCfg({
          match_keywords: s.companies?.match_keywords || '',
          scan_interval_minutes: s.companies?.scan_interval_minutes || 180,
          auto_scan: s.companies?.auto_scan !== false,
        })
        setPrefsHint({
          roles: s.job_prefs?.target_roles || [],
          locations: s.job_prefs?.locations || [],
        })
      })
      .catch(() =>
        setCfg({ match_keywords: '', scan_interval_minutes: 180, auto_scan: true }),
      )
  }, [])

  const setBusy = (id: number, on: boolean) =>
    setScanning((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const scanOne = useCallback(
    async (company: Company) => {
      setBusy(company.id, true)
      try {
        const { result } = await api.scanCompany(company.id)
        toast(
          result.found === 0
            ? `${company.name}: no job links found — see the note on the company row.`
            : `${company.name}: ${result.found} jobs, ${result.matched} match your profile (${result.new} new).`,
          result.found === 0 ? 'error' : 'success',
        )
      } catch (err) {
        toast(`${company.name}: ${(err as Error).message}`, 'error')
      } finally {
        setBusy(company.id, false)
        load()
      }
    },
    [load, toast],
  )

  const addCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) {
      toast('Enter both a company name and its careers page URL.', 'error')
      return
    }
    setAdding(true)
    try {
      const created = await api.addCompany(name.trim(), url.trim())
      setName('')
      setUrl('')
      load()
      toast(`${created.name} added — scanning now…`, 'success')
      await scanOne(created)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setAdding(false)
    }
  }

  const scanAll = useCallback(async () => {
    if (!companies?.length) return
    setScanningAll(true)
    try {
      await api.scanAllCompanies()
      toast(
        `Scanning ${companies.length} compan${companies.length > 1 ? 'ies' : 'y'} in the background…`,
      )
      setTimeout(load, 6000)
      setTimeout(load, 20000)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setScanningAll(false)
    }
  }, [companies, load, toast])

  const removeCompany = async (company: Company) => {
    if (!window.confirm(`Remove ${company.name} and all its scanned jobs?`)) return
    try {
      await api.deleteCompany(company.id)
      toast(`${company.name} removed.`)
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const saveCfg = async () => {
    if (!cfg) return
    setCfgSaving(true)
    try {
      await api.saveSettings({ companies: cfg })
      toast('Scan settings saved — rescanning to re-match jobs…', 'success')
      void scanAll()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCfgSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        large
        title="Companies"
        sub="Watch career pages — matching openings appear under Openings"
      />

      <div className="settings-stack">
        <CompaniesTabs
          active="manage"
          newCount={newTotal}
          companiesCount={companies?.length || 0}
        />

        <div className="card">
          <h3>
            <BuildingIcon style={{ width: 18, height: 18 }} /> Add a company
          </h3>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            Paste a careers page URL. Job boards (Greenhouse, Lever, Workday, Ashby…) and
            Amazon, Google and Microsoft careers work best.
          </p>
          <form onSubmit={addCompany} className="grid-2" style={{ alignItems: 'end' }}>
            <label className="field">
              <span className="lbl">Company name</span>
              <input
                value={name}
                placeholder="e.g. Stripe"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="lbl">Careers page URL</span>
              <input
                value={url}
                placeholder="e.g. stripe.com/jobs or boards.greenhouse.io/…"
                onChange={(e) => setUrl(e.target.value)}
              />
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
            <h3 style={{ marginBottom: 0 }}>
              <BuildingIcon style={{ width: 18, height: 18 }} /> Watched companies
            </h3>
            {(companies?.length ?? 0) > 0 && (
              <button className="btn sm" disabled={scanningAll} onClick={scanAll}>
                {scanningAll ? 'Starting…' : 'Scan all now'}
              </button>
            )}
          </div>
          {loadErr && companies === null && (
            <div style={{ marginTop: 14 }}>
              <p className="error-text" style={{ marginBottom: 10 }}>
                Couldn’t load companies: {loadErr}
              </p>
              <button className="btn sm primary" onClick={load}>
                Retry
              </button>
            </div>
          )}
          {companies === null && !loadErr && (
            <p className="muted" style={{ marginTop: 14 }}>
              Loading…
            </p>
          )}
          {companies?.length === 0 && (
            <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
              No companies yet — add your first one above.
            </p>
          )}
          {(companies?.length ?? 0) > 0 && (
            <div className="company-list">
              {companies!.map((c) => (
                <div key={c.id} className="company-row">
                  <div className="c-main">
                    <div className="c-name">{c.name}</div>
                    <div className="c-sub">
                      <a href={c.career_url} target="_blank" rel="noreferrer">
                        {hostOf(c.career_url)}
                      </a>
                      {' · '}scanned {timeAgo(c.last_scanned_at)}
                      {c.last_status === 'ok' && (
                        <>
                          {' · '}
                          {c.jobs_found} jobs,{' '}
                          <strong style={{ color: 'var(--text)' }}>
                            {c.matched_jobs} matched
                          </strong>
                        </>
                      )}
                      {c.ats_type && c.ats_type !== 'custom' && <> · detected: {c.ats_type} ✓</>}
                    </div>
                    <select
                      aria-label="Priority"
                      value={c.priority ?? 'normal'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        const priority = e.target.value
                        try {
                          await career.setCompanyPriority(c.id, priority)
                          setCompanies((list) => list?.map((x) => (x.id === c.id ? { ...x, priority: priority as Company['priority'] } : x)) ?? list)
                        } catch (err) {
                          toast((err as Error).message, 'error')
                        }
                      }}
                      style={{ width: 'auto', marginTop: 6, padding: '5px 30px 5px 10px', fontSize: 12 }}
                    >
                      <option value="high">High priority</option>
                      <option value="normal">Normal priority</option>
                      <option value="low">Low priority</option>
                    </select>
                    {c.last_status === 'error' && (
                      <div className="error-text" style={{ marginTop: 4 }}>
                        ⚠ {c.last_error}
                      </div>
                    )}
                    {c.last_status === 'empty' && (
                      <div className="warn-text" style={{ marginTop: 4 }}>
                        {c.last_error}
                      </div>
                    )}
                  </div>
                  {(c.new_jobs ?? 0) > 0 && (
                    <button
                      className="badge review"
                      style={{ border: 'none', cursor: 'pointer' }}
                      title="Show these new openings"
                      onClick={() => navigate(`/companies?company=${c.id}`)}
                    >
                      {c.new_jobs} new
                    </button>
                  )}
                  <button
                    className="btn sm"
                    disabled={scanning.has(c.id)}
                    onClick={() => scanOne(c)}
                  >
                    {scanning.has(c.id) ? 'Scanning…' : 'Scan'}
                  </button>
                  <button
                    className="icon-x"
                    title="Remove company"
                    onClick={() => removeCompany(c)}
                  >
                    <XIcon style={{ width: 15, height: 15 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3>
            <ListIcon style={{ width: 18, height: 18 }} /> Matching & scanning
          </h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Every job is scored against your <strong>Job preferences</strong> (target roles,
            locations, seniority) and the skills on your resume. Amazon, Google and Microsoft are
            searched with your target roles and locations.
          </p>
          <p className={prefsHint.roles.length ? 'muted' : 'warn-text'} style={{ fontSize: 13, marginBottom: 12 }}>
            {prefsHint.roles.length ? (
              <>
                Roles: <strong>{prefsHint.roles.join(', ')}</strong>
                {prefsHint.locations.length ? (
                  <>
                    {' '}· Locations: <strong>{prefsHint.locations.join(', ')}</strong>
                  </>
                ) : null}
                {' '}·{' '}
              </>
            ) : (
              <>No target roles set, so matching uses the job titles on your resume. </>
            )}
            <a onClick={() => navigate('/settings/preferences')} style={{ cursor: 'pointer' }}>
              {prefsHint.roles.length ? 'Change' : 'Set your roles & locations'}
            </a>
          </p>
          {cfg && (
            <div className="stack">
              <div className="grid-2">
                <label className="field">
                  <span className="lbl">Auto-scan schedule</span>
                  <select
                    value={String(cfg.scan_interval_minutes)}
                    onChange={(e) =>
                      setCfg((c) =>
                        c ? { ...c, scan_interval_minutes: Number(e.target.value) } : c,
                      )
                    }
                  >
                    {INTERVALS.map(([m, label]) => (
                      <option key={m} value={String(m)}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toggle" style={{ alignSelf: 'end', paddingBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={cfg.auto_scan}
                    onChange={(e) =>
                      setCfg((c) => (c ? { ...c, auto_scan: e.target.checked } : c))
                    }
                  />
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
