'use client'

/**
 * Applications: every careers-page application, in one list you can act on.
 *
 *   tabs       Needs you · In progress · Applied · Screening · Interview · Offer · Rejected · Ghosted
 *   summary    applied, this week, heard back — only once there's something to sum up
 *   rows       in progress: the next step; submitted: the stage, changeable in place
 */
import { useEffect, useMemo, useState } from 'react'

import Monogram from '@/components/career/Monogram'
import { NEXT_STEP, StatusPill, timeAgo, WAITS_ON_YOU } from '@/components/career/ui'
import { BriefcaseIcon, ChevronRight } from '@/components/Icons'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { TrackerRow } from '@/lib/career-api'
import type { AppStage } from '@/lib/types'

const STAGES: AppStage[] = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted']
const STAGE_LABEL: Record<AppStage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
}
type Tab = 'needs' | 'progress' | AppStage
const LINE: Tab[] = ['needs', 'progress', 'applied', 'screening', 'interview', 'offer']
const LABEL: Record<Tab, string> = { needs: 'Needs you', progress: 'In progress', ...STAGE_LABEL }

const DAY = 86_400_000

export default function TrackerPage() {
  const [rows, setRows] = useState<TrackerRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab | null>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const load = () => career.sessions().then(setRows).catch((e) => setErr((e as Error).message))
  useEffect(() => {
    void load()
  }, [])

  const groups = useMemo(() => {
    const list = (rows ?? []).filter((r) => r.status !== 'cancelled')
    const submitted = list.filter((r) => r.status === 'submitted')
    const open = list.filter((r) => r.status !== 'submitted')
    const g: Record<Tab, TrackerRow[]> = {
      needs: open.filter((r) => WAITS_ON_YOU.includes(r.status)),
      progress: open,
      ...(Object.fromEntries(STAGES.map((s) => [s, submitted.filter((r) => (r.stage ?? 'applied') === s)])) as Record<AppStage, TrackerRow[]>),
    }
    const heard = submitted.filter((r) => r.stage && !['applied', 'ghosted'].includes(r.stage)).length
    return {
      g,
      submitted,
      week: submitted.filter((r) => r.submitted_at && Date.now() - Date.parse(r.submitted_at) < 7 * DAY).length,
      heardPct: submitted.length ? Math.round((heard / submitted.length) * 100) : 0,
    }
  }, [rows])

  // Open on the tab that has something: what needs you, else what's running, else what you sent.
  const current: Tab = tab ?? (groups.g.needs.length ? 'needs' : groups.g.progress.length ? 'progress' : 'applied')
  const shown = groups.g[current]

  const move = async (r: TrackerRow, stage: AppStage) => {
    try {
      await career.stage(r.id, stage)
      void load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const total = (rows ?? []).filter((r) => r.status !== 'cancelled').length

  return (
    <div className="wide">
      <PageHeader
        large
        title="Applications"
        sub={
          !rows
            ? 'Loading…'
            : groups.submitted.length
              ? `${groups.submitted.length} applied${groups.week ? `, ${groups.week} this week` : ''}${groups.submitted.length >= 3 ? `, ${groups.heardPct}% heard back` : ''}`
              : total
                ? 'Nothing submitted yet — finish one below and it moves to Applied.'
                : 'Everything you apply to on a careers page, from start to offer.'
        }
      />
      {err && <div className="err-box">{err}</div>}

      {rows && total === 0 ? (
        <div className="card empty-state">
          <span className="es-icon"><BriefcaseIcon /></span>
          <b>No applications yet</b>
          <p>Pick a job and press Apply. The browser fills the form from your profile and stops for you to check it before anything is sent.</p>
          <button className="btn primary" onClick={() => navigate('/jobs')}>Find a job to apply to</button>
        </div>
      ) : (
        <>
          {/* The journey: stations on a gold thread, from what needs you to an offer.
              Rejected and ghosted sit off the line. Each station is a tab. */}
          <div className="journey" role="tablist" aria-label="Application stage">
            <ol className="journey-line">
              {LINE.map((k) => {
                const n = groups.g[k].length
                return (
                  <li key={k}>
                    <button
                      role="tab"
                      aria-selected={current === k}
                      className={`station ${current === k ? 'on' : ''} ${n ? 'has' : ''} ${k === 'needs' && n ? 'alert' : ''}`}
                      onClick={() => setTab(k)}
                    >
                      <span className="st-dot" aria-hidden="true" />
                      <span className="st-n">{n}</span>
                      <span className="st-label">{LABEL[k]}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <div className="journey-side">
              {(['rejected', 'ghosted'] as Tab[]).map((k) => (
                <button key={k} role="tab" aria-selected={current === k} className={`side-stop ${current === k ? 'on' : ''}`} onClick={() => setTab(k)}>
                  {LABEL[k]} <b>{groups.g[k].length}</b>
                </button>
              ))}
            </div>
          </div>

          {!rows && <div className="skeleton" style={{ height: 160 }} />}
          {rows && shown.length === 0 && (
            <p className="muted small" style={{ padding: '18px 2px' }}>
              {current === 'needs'
                ? 'Nothing is waiting on you.'
                : current === 'progress'
                  ? 'Nothing in progress.'
                  : `No applications at ${STAGE_LABEL[current as AppStage].toLowerCase()} yet. Move one here from Applied when you hear back.`}
            </p>
          )}

          <div className="app-rows">
            {shown.map((r) =>
              r.status === 'submitted' ? (
                <div key={r.id} className="app-row">
                  <Monogram name={r.company_name} />
                  <button className="app-row-main" onClick={() => navigate(`/apply/${r.id}`)}>
                    <span className="ar-title">{r.job_title}</span>
                    <span className="ar-sub">{r.company_name}, applied {timeAgo(r.submitted_at)}</span>
                  </button>
                  <select value={r.stage ?? 'applied'} onChange={(e) => move(r, e.target.value as AppStage)} aria-label={`Stage for ${r.job_title}`}>
                    {STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}
                  </select>
                </div>
              ) : (
                <button key={r.id} className="app-row" onClick={() => navigate(`/apply/${r.id}`)}>
                  <Monogram name={r.company_name} />
                  <span className="app-row-main">
                    <span className="ar-title">{r.job_title}</span>
                    <span className="ar-sub">{r.company_name}, started {timeAgo(r.started_at)}</span>
                    {NEXT_STEP[r.status] && (
                      <span className={`ar-next ${WAITS_ON_YOU.includes(r.status) ? 'you' : ''}`}>
                        {NEXT_STEP[r.status]}
                        {r.needs_you > 0 && r.status === 'needs_input' ? ` (${r.needs_you})` : ''}
                      </span>
                    )}
                  </span>
                  <StatusPill status={r.status} />
                  <ChevronRight className="ar-go" />
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  )
}
