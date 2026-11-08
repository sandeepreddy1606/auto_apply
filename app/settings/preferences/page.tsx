'use client'

import { useEffect, useState } from 'react'

import { ChipInput } from '@/components/career/ui'
import PageHeader from '@/components/PageHeader'
import { LoadError, SaveBar, useGuardedBack, useSection } from '@/components/settings/shared'
import { api } from '@/lib/api'
import { career } from '@/lib/career-api'
import type { Company, JobPrefs, Seniority } from '@/lib/types'

const SENIORITY: [Seniority, string][] = [
  ['intern', 'Intern'],
  ['new_grad', 'New grad'],
  ['junior', 'Junior / 0–2 y'],
  ['mid', 'Mid / 2–5 y'],
  ['senior', 'Senior'],
]
const ROLE_SUGGESTIONS = ['Software Engineer', 'Backend Engineer', 'Full Stack Engineer', 'SDE', 'ML Engineer', 'AI Engineer', 'Frontend Engineer', 'Data Engineer']
const CITY_SUGGESTIONS = ['Chennai', 'Bengaluru', 'Hyderabad', 'Pune', 'Mumbai', 'Gurugram', 'Noida', 'Remote']

export default function PreferencesPage() {
  const s = useSection<JobPrefs & Record<string, unknown>>('job_prefs', null)
  const back = useGuardedBack()
  const [count, setCount] = useState<{ relevant: number; total: number } | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])

  useEffect(() => {
    api.listCompanies().then(setCompanies).catch(() => {})
  }, [])

  // Live "N of M relevant" for the current (unsaved) preferences.
  const dataKey = JSON.stringify(s.data)
  useEffect(() => {
    if (!s.data) return
    const t = setTimeout(() => career.previewCount(s.data!).then(setCount).catch(() => {}), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey])

  if (s.loadError) return (<><PageHeader title="Job preferences" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>)
  if (!s.data) return (<><PageHeader title="Job preferences" backTo="/settings" /><p className="muted">Loading…</p></>)
  const p = s.data

  return (
    <>
      <PageHeader title="Job preferences" sub="Decides which jobs count as relevant, and their score" onBack={back} />
      <div className="settings-stack">
        <div className="card">
          <h3>Target roles</h3>
          <ChipInput value={p.target_roles} onChange={s.set('target_roles')} placeholder="e.g. Software Engineer" suggestions={ROLE_SUGGESTIONS} />
          <p className="muted small" style={{ marginTop: 8 }}>Synonyms count too: “Software Engineer” also matches SDE, Software Developer, SWE.</p>
        </div>

        <div className="card">
          <h3>Seniority you’ll apply for</h3>
          <div className="stack" style={{ gap: 8 }}>
            {SENIORITY.map(([k, label]) => (
              <label key={k} className="toggle">
                <input type="checkbox" checked={p.seniority.includes(k)} onChange={(e) => s.set('seniority')(e.target.checked ? [...p.seniority, k] : p.seniority.filter((x) => x !== k))} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span className="lbl">Your experience in years (blank = computed from your resume dates)</span>
            <input value={p.experience_years_override} placeholder="e.g. 0.8" onChange={(e) => s.set('experience_years_override')(e.target.value)} />
          </label>
        </div>

        <div className="card">
          <h3>Locations</h3>
          <ChipInput value={p.locations} onChange={s.set('locations')} placeholder="e.g. Bengaluru" suggestions={CITY_SUGGESTIONS} />
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <label className="toggle"><input type="checkbox" checked={p.remote_ok} onChange={(e) => s.set('remote_ok')(e.target.checked)} /><span>Remote jobs are OK</span></label>
            <label className="toggle"><input type="checkbox" checked={p.open_to_relocation} onChange={(e) => s.set('open_to_relocation')(e.target.checked)} /><span>Open to relocating (other cities score lower, not zero)</span></label>
          </div>
        </div>

        <div className="card">
          <h3>Keywords</h3>
          <span className="lbl small muted">Boost jobs mentioning</span>
          <ChipInput value={p.include_keywords} onChange={s.set('include_keywords')} placeholder="e.g. Spring Boot" />
          <div style={{ height: 12 }} />
          <span className="lbl small muted">Hide jobs whose title contains</span>
          <ChipInput value={p.exclude_keywords} onChange={s.set('exclude_keywords')} placeholder="e.g. Senior" />
        </div>

        <div className="card">
          <h3>Excluded companies</h3>
          {companies.length === 0 ? (
            <p className="muted small">No companies added yet.</p>
          ) : (
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {companies.map((c) => {
                const on = p.excluded_companies.includes(c.id)
                return (
                  <button key={c.id} className={`chip ${on ? 'active' : ''}`} onClick={() => s.set('excluded_companies')(on ? p.excluded_companies.filter((x) => x !== c.id) : [...p.excluded_companies, c.id])}>
                    {on ? '✕ ' : ''}{c.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h3>Relevance threshold</h3>
          <div className="range-row">
            <input type="range" min={0} max={100} value={p.threshold} onChange={(e) => s.set('threshold')(Number(e.target.value))} />
            <span className="score mid">{p.threshold}</span>
          </div>
          <p className="small" style={{ marginTop: 8 }}>
            {count ? <><b>{count.relevant}</b> of {count.total} active jobs would be relevant.</> : <span className="muted">Counting…</span>}
          </p>
          <label className="toggle" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={p.require_title_match !== false} onChange={(e) => s.set('require_title_match')(e.target.checked)} />
            <span>Only count jobs whose title matches one of my target roles</span>
          </label>
          <label className="field" style={{ marginTop: 12 }}>
            <span className="lbl">Hide jobs that ask for more experience than I have by</span>
            <select value={p.max_experience_gap ?? 2} onChange={(e) => s.set('max_experience_gap')(Number(e.target.value))}>
              {[1, 2, 3, 5].map((y) => <option key={y} value={y}>more than {y} year{y > 1 ? 's' : ''}</option>)}
              <option value={10}>Don’t hide by experience</option>
            </select>
          </label>
          <label className="field" style={{ marginTop: 12 }}>
            <span className="lbl">Freshness window</span>
            <select value={p.freshness_days} onChange={(e) => s.set('freshness_days')(Number(e.target.value))}>
              {[7, 14, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
        </div>

        <button className="btn primary" style={{ padding: 15 }} disabled={s.saving || !s.dirty} onClick={s.save}>
          {s.saving ? 'Saving…' : s.dirty ? 'Save & re-score all jobs' : 'All changes saved'}
        </button>
      </div>
      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount} onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
