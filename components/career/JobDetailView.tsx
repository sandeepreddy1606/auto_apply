'use client'

import { useEffect, useRef, useState } from 'react'

import { useNavigate } from '@/components/Navigation'
import { BoltIcon, ClockIcon, PinIcon } from '@/components/Icons'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { JobDetail, JobRequirements } from '@/lib/types'

import { Breakdown, ScorePill, StatusPill, timeAgo } from './ui'
import { platformLabel } from '@/lib/companies/names'

const EDU: Record<string, string> = { phd: 'PhD', masters: "Master's degree", bachelors: "Bachelor's degree", diploma: 'Diploma' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** What the description asks for, read from its text: one row per detail found. */
function Requirements({ r }: { r: JobRequirements }) {
  const rows: [string, string, string?][] = []
  if (r.experience) {
    const e = r.experience
    rows.push(['Experience', e.text === 'entry level' ? 'Entry level / new grad' : e.max !== null ? `${e.min}–${e.max} years` : `${e.min}+ years`, e.text === 'entry level' ? undefined : `“${e.text}”`])
  }
  if (r.experience_preferred) rows.push(['Preferred', `${r.experience_preferred.min}+ years`, `“${r.experience_preferred.text}”`])
  if (r.education?.level) {
    rows.push(['Education', `${EDU[r.education.level]}${r.education.fields.length ? ` in ${r.education.fields.join(' / ')}` : ''}${r.education.equivalent ? ', or equivalent experience' : ''}`])
  }
  if (r.employment_type) rows.push(['Job type', cap(r.employment_type)])
  if (r.work_mode) rows.push(['Work mode', r.work_mode === 'onsite' ? 'On-site' : cap(r.work_mode)])
  if (r.salary) rows.push(['Pay', r.salary])
  if (r.visa) rows.push(['Visa', r.visa === 'sponsors' ? 'Sponsorship available' : 'No visa sponsorship'])
  if (r.notice) rows.push(['Joining', cap(r.notice)])
  if (r.shift) rows.push(['Shift', cap(r.shift)])
  if (r.travel) rows.push(['Travel', cap(r.travel)])
  if (!rows.length) return null
  return (
    <div className="req-grid">
      {rows.map(([k, v, q]) => (
        <div key={k} className="req">
          <span className="req-k">{k}</span>
          <span className="req-v">{v}</span>
          {q && <span className="req-q">{q}</span>}
        </div>
      ))}
    </div>
  )
}

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
  // Stops after about a minute, so a description that can't be fetched doesn't poll forever.
  const polls = useRef(0)
  useEffect(() => {
    polls.current = 0
  }, [id])
  useEffect(() => {
    if (!job || job.has_description || polls.current >= 12) return
    polls.current++
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
    polls.current = 0
    toast('Fetching the description…', 'info')
    setJob({ ...job, has_description: false })
  }
  const b = job.match_breakdown
  const active = job.sessions.find((s) => s.status !== 'cancelled')

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <ScorePill score={job.match_score} breakdown={b} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="jd-title">{job.title}</h2>
          <div className="meta" style={{ marginTop: 6 }}>
            <span className="strong">{job.company_name}</span>
            {job.location && <span><PinIcon />{job.location}</span>}
            <span><ClockIcon />{timeAgo(job.posted_at || job.first_seen_at)}</span>
            {platformLabel(job.ats_type, job.company_name) && <span>via {platformLabel(job.ats_type, job.company_name)}</span>}
          </div>
        </div>
      </div>

      {b?.excluded && <div className="warn-box" style={{ marginTop: 12 }}>Filtered out: {b.excluded}. You can still apply.</div>}

      {job.active === 0 && <div className="warn-box" style={{ marginTop: 12 }}>This posting is no longer listed on the company’s site — it may have closed.</div>}

      {job.siblings && job.siblings.length > 0 && (
        <div className="small" style={{ marginTop: 10, color: 'var(--dim)' }}>
          Also posted in:{' '}
          {job.siblings.slice(0, 12).map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <a href={`/jobs/${s.id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${s.id}`) }}>{s.location || 'another location'}</a>
            </span>
          ))}
          {job.siblings.length > 12 ? ` and ${job.siblings.length - 12} more` : ''}
        </div>
      )}

      {job.requirements && <Requirements r={job.requirements} />}

      {b && <Breakdown b={b} />}

      {job.keywords && (job.keywords.required.length > 0 || job.keywords.preferred.length > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Skills in this job — gold ones are on your resume</div>
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
            {busy ? <span className="spin" /> : <BoltIcon fill="currentColor" strokeWidth={0} />} Apply
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
