'use client'

import { useEffect, useMemo, useState } from 'react'

import { StatusPill, timeAgo } from '@/components/career/ui'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { TrackerRow } from '@/lib/career-api'
import type { AppStage } from '@/lib/types'

const STAGES: AppStage[] = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted']

export default function TrackerPage() {
  const [rows, setRows] = useState<TrackerRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const load = () => career.sessions().then(setRows).catch((e) => setErr((e as Error).message))
  useEffect(() => {
    void load()
  }, [])

  const { inProgress, byStage, stats } = useMemo(() => {
    const list = rows ?? []
    const inProgress = list.filter((r) => !['submitted', 'cancelled'].includes(r.status))
    const submitted = list.filter((r) => r.status === 'submitted')
    const byStage: Record<string, TrackerRow[]> = Object.fromEntries(STAGES.map((s) => [s, []]))
    for (const r of submitted) byStage[r.stage ?? 'applied'].push(r)
    const responded = submitted.filter((r) => r.stage && r.stage !== 'applied' && r.stage !== 'ghosted').length
    return {
      inProgress,
      byStage,
      stats: {
        submitted: submitted.length,
        week: submitted.filter((r) => r.submitted_at && Date.now() - Date.parse(r.submitted_at) < 7 * 86_400_000).length,
        responseRate: submitted.length ? Math.round((responded / submitted.length) * 100) : 0,
        interviews: submitted.filter((r) => r.stage === 'interview' || r.stage === 'offer').length,
      },
    }
  }, [rows])

  const move = async (r: TrackerRow, stage: AppStage) => {
    try {
      await career.stage(r.id, stage)
      void load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="wide">
      <PageHeader large title="Applications" sub="Career-page applications: in progress and after you applied" />
      {err && <div className="err-box">{err}</div>}

      <div className="kpis">
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">Submitted</div><div className="k-value">{stats.submitted}</div></div>
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">This week</div><div className="k-value">{stats.week}</div></div>
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">Response rate</div><div className="k-value">{stats.responseRate}%</div></div>
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">Interviews</div><div className="k-value">{stats.interviews}</div></div>
      </div>

      <div className="section">
        <h3>In progress ({inProgress.length})</h3>
        {!rows && <div className="skeleton" />}
        {rows && inProgress.length === 0 && (
          <p className="muted small">
            Nothing in progress. <button className="link-btn" onClick={() => navigate('/jobs')}>Find a job</button>
          </p>
        )}
        <div className="job-cards">
          {inProgress.map((r) => (
            <div key={r.id} className="job-card" style={{ gridTemplateColumns: '1fr auto' }} onClick={() => navigate(`/apply/${r.id}`)}>
              <div style={{ minWidth: 0 }}>
                <div className="jc-title">{r.job_title}</div>
                <div className="jc-meta">{r.company_name}, started {timeAgo(r.started_at)}</div>
                {r.error && <div className="jc-why truncate">{r.error}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
                <StatusPill status={r.status} />
                {r.needs_you > 0 && <span className="pill bad">{r.needs_you} need you</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h3>After you applied</h3>
        <div className="kanban">
          {STAGES.map((st) => (
            <div key={st} className="kcol">
              <h4>
                <span>{st}</span>
                <span>{byStage[st].length}</span>
              </h4>
              {byStage[st].map((r) => (
                <div key={r.id} className="kcard">
                  <div className="t" onClick={() => navigate(`/apply/${r.id}`)}>{r.job_title}</div>
                  <div className="c">{r.company_name}, {timeAgo(r.submitted_at)}</div>
                  <select value={r.stage ?? 'applied'} onChange={(e) => move(r, e.target.value as AppStage)} aria-label="Move to stage">
                    {STAGES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
