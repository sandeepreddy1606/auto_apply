'use client'

import { useEffect, useState } from 'react'

import { useNavigate } from '@/components/Navigation'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { JobDetail } from '@/lib/types'

import { Breakdown, ScorePill, StatusPill, timeAgo } from './ui'

/** Job description, score breakdown, keywords and the Apply button. Used in the split pane and on /jobs/[id]. */
export default function JobDetailView({ id, onChanged }: { id: number; onChanged?: () => void }) {
  const [job, setJob] = useState<JobDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const load = () =>
    career
      .job(id)
      .then((j) => {
        setJob(j)
        setErr(null)
      })
      .catch((e) => setErr((e as Error).message))

  useEffect(() => {
    setJob(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // While the description is being fetched, check back.
  useEffect(() => {
    if (!job || job.has_description) return
    const t = setTimeout(() => void load(), 5000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job])

  if (err) return <div className="card"><p className="error-text">{err}</p></div>
  if (!job) return <div className="card"><div className="skeleton" /><div className="skeleton" style={{ marginTop: 10, height: 240 }} /></div>

  const apply = async () => {
    setBusy(true)
    try {
      const r = await career.startApply(job.id)
      for (const w of r.warnings) toast(w, 'info')
      navigate(`/apply/${r.session_id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const setState = async (state: string) => {
    try {
      setJob(await career.setJobState(job.id, state))
      onChanged?.()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const refresh = async () => {
    await career.refreshJob(job.id)
    toast('Fetching the description…', 'info')
    setJob({ ...job, has_description: false })
  }
  const b = job.match_breakdown
  const active = job.sessions.find((s) => s.status !== 'cancelled')

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <ScorePill score={job.match_score} breakdown={b} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 19, lineHeight: 1.25, letterSpacing: -0.3 }}>{job.title}</h2>
          <div className="muted small" style={{ marginTop: 4 }}>
            {job.company_name}
            {job.location ? ` · ${job.location}` : ''}
            {` · ${timeAgo(job.posted_at || job.first_seen_at)}`}
            {job.ats_type && job.ats_type !== 'custom' ? ` · ${job.ats_type}` : ''}
          </div>
        </div>
      </div>

      {b?.excluded && <div className="warn-box" style={{ marginTop: 12 }}>Filtered out: {b.excluded}. You can still apply.</div>}
      {b && <Breakdown b={b} />}

      {job.keywords && (job.keywords.required.length > 0 || job.keywords.preferred.length > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Skills in this job (green = on your resume)</div>
          <div className="kw">
            {[...job.keywords.required, ...job.keywords.preferred].map((k) => (
              <span key={k} className={b?.skills_have.includes(k) ? 'have' : 'miss'}>
                {k}
                {job.keywords!.preferred.includes(k) ? ' (nice)' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="row-actions" style={{ marginTop: 6 }}>
        {active ? (
          <button className="btn primary" onClick={() => navigate(`/apply/${active.id}`)}>
            Continue application <StatusPill status={active.status} />
          </button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={apply}>
            {busy ? <span className="spin" /> : '⚡'} Apply
          </button>
        )}
        {job.state !== 'shortlisted' ? (
          <button className="btn sm" onClick={() => setState('shortlisted')}>☆ Shortlist</button>
        ) : (
          <button className="btn sm" onClick={() => setState('seen')}>★ Shortlisted</button>
        )}
        {job.state !== 'dismissed' ? (
          <button className="btn sm" onClick={() => setState('dismissed')}>Dismiss</button>
        ) : (
          <button className="btn sm" onClick={() => setState('seen')}>Restore</button>
        )}
        <a className="btn sm" href={job.url} target="_blank" rel="noreferrer">Original ↗</a>
      </div>

      <div className="section">
        <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
          Job description
          <button className="link-btn small" onClick={refresh}>Refresh</button>
        </h3>
        {job.description_html ? (
          // Sanitized on the server with a strict tag allowlist (lib/jobs/html.ts).
          <div className="jd-html" dangerouslySetInnerHTML={{ __html: job.description_html }} />
        ) : job.description_text ? (
          <div className="jd-html" style={{ whiteSpace: 'pre-wrap' }}>{job.description_text}</div>
        ) : (
          <p className="muted small"><span className="spin" /> Fetching the description from the career site…</p>
        )}
      </div>

      {job.sessions.length > 0 && (
        <div className="section">
          <h3>History</h3>
          {job.sessions.map((s) => (
            <div key={s.id} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <StatusPill status={s.status} />
              {s.stage && <span className="pill">{s.stage}</span>}
              <span className="muted">{timeAgo(s.started_at)}</span>
              <button className="link-btn" onClick={() => navigate(`/apply/${s.id}`)}>Open</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
