'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'

import ResumeStudio from '@/components/career/ResumeStudio'
import ReviewPanel from '@/components/career/ReviewPanel'
import { StatusPill, timeAgo } from '@/components/career/ui'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { career, streamSession } from '@/lib/career-api'
import type { ApplyDetail } from '@/lib/career-api'
import type { AppStage, SessionStatus } from '@/lib/types'

type Step = 'resume' | 'fill' | 'done'

const RESUME_STATES: SessionStatus[] = ['created', 'resume_drafting']
const DONE_STATES: SessionStatus[] = ['submitted', 'cancelled']
const STAGES: AppStage[] = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted']

function stepFor(status: SessionStatus): Step {
  if (RESUME_STATES.includes(status)) return 'resume'
  if (DONE_STATES.includes(status)) return 'done'
  return 'fill'
}

const EVENT_TEXT: Record<string, string> = {
  'session.created': 'Application started',
  'resume.generate': 'Asked AI to tailor the resume',
  'resume.locked': 'Resume locked',
  'resume.edited': 'Edited the resume',
  'resume.reused': 'Reused an earlier resume',
  'fill.queued': 'Autofill queued',
  'fill.started': 'Opened the application form',
  'fill.step': 'Filled a page',
  'fill.done': 'Form filled',
  'answers.updated': 'Updated answers',
  'submit.clicked': 'Clicked submit',
  'submit.confirmed': 'Confirmation page detected ✓',
  'submit.confirmed_by_user': 'You confirmed it was submitted',
  'submit.not_confirmed': 'Back to review',
  'stage.changed': 'Stage changed',
  'session.cancelled': 'Cancelled',
  'artifact.added': 'Screenshot',
}

export default function ApplyPage({ params }: { params: Promise<{ sid: string }> }) {
  const sid = Number(use(params).sid)
  const [d, setD] = useState<ApplyDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [step, setStep] = useState<Step | null>(null)
  const [showLog, setShowLog] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const lastEvent = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback(() => {
    career
      .session(sid)
      .then((x) => {
        setD(x)
        setErr(null)
        lastEvent.current = x.events.at(-1)?.id ?? lastEvent.current
        setStep((cur) => cur ?? stepFor(x.session.status))
      })
      .catch((e) => setErr((e as Error).message))
  }, [sid])

  // Debounced reload, so a burst of events triggers one fetch.
  const reload = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 250)
  }, [load])

  useEffect(load, [load])

  // Live updates from the worker; a slow poll backs it up (e.g. while generating).
  useEffect(() => {
    if (!d) return
    const close = streamSession(sid, lastEvent.current, () => reload())
    return close
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, !!d])
  useEffect(() => {
    const busy = d && (['filling', 'submitting'].includes(d.session.status) || d.versions.some((v) => v.status === 'generating'))
    const t = setInterval(load, busy ? 4000 : 20000)
    return () => clearInterval(t)
  }, [d, load])

  // Move forward automatically when the status crosses into the next step.
  const status = d?.session.status
  const prevStatus = useRef<SessionStatus | undefined>(undefined)
  useEffect(() => {
    if (!status) return
    if (prevStatus.current && stepFor(prevStatus.current) !== stepFor(status)) setStep(stepFor(status))
    prevStatus.current = status
  }, [status])

  if (err) {
    return (
      <>
        <PageHeader title="Application" backTo="/jobs" />
        <div className="err-box">{err}</div>
      </>
    )
  }
  if (!d) {
    return (
      <div className="wide">
        <PageHeader title="Application" backTo="/jobs" />
        <div className="skeleton" />
        <div className="skeleton" style={{ marginTop: 12, height: 400 }} />
      </div>
    )
  }

  const s = d.session
  const job = d.job
  const lockedV = d.versions.find((v) => v.status === 'locked')
  const steps: [Step, string, boolean][] = [
    ['resume', 'Resume', !!lockedV],
    ['fill', 'Fill & review', s.status === 'submitted'],
    ['done', 'Done', s.status === 'submitted'],
  ]
  const setStage = async (stage: AppStage) => {
    try {
      await career.stage(s.id, stage)
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="wide">
      <PageHeader
        title={job ? `${job.title}` : `Application #${s.id}`}
        sub={
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {job?.company_name}
            {s.ats_type && s.ats_type !== 'custom' ? ` · ${s.ats_type}` : ''} <StatusPill status={s.status} />
          </span>
        }
        backTo="/jobs"
        actions={
          job && (
            <a className="btn sm" href={s.apply_url ?? job.url} target="_blank" rel="noreferrer">
              Posting ↗
            </a>
          )
        }
      />

      <div className="stepper">
        {steps.map(([k, label, done], i) => (
          <button key={k} className={`st ${step === k ? 'on' : ''} ${done ? 'done' : ''}`} onClick={() => setStep(k)}>
            <i>{done ? '✓' : i + 1}</i> {label}
          </button>
        ))}
      </div>

      {step === 'resume' && (
        <>
          <ResumeStudio d={d} reload={reload} />
          {lockedV && (
            <div className="row-actions">
              <button className="btn primary" onClick={() => setStep('fill')}>Next: fill the application →</button>
            </div>
          )}
        </>
      )}

      {step === 'fill' && (
        <>
          {!lockedV && (
            <div className="warn-box" style={{ marginBottom: 12 }}>
              Lock a resume version first. <button className="link-btn" onClick={() => setStep('resume')}>Go to Resume →</button>
            </div>
          )}
          <ReviewPanel d={d} reload={reload} />
        </>
      )}

      {step === 'done' && (
        <div className="card">
          {s.status === 'submitted' ? (
            <>
              <h2 style={{ fontSize: 20 }}>Applied ✓</h2>
              <p className="muted small" style={{ marginTop: 4 }}>
                Submitted {timeAgo(s.submitted_at)} with resume v{s.resume_version_id}.
              </p>
              <div className="section">
                <h3>What happened next?</h3>
                <div className="chips" style={{ flexWrap: 'wrap' }}>
                  {STAGES.map((st) => (
                    <button key={st} className={`chip ${s.stage === st ? 'active' : ''}`} onClick={() => setStage(st)}>
                      {st}
                    </button>
                  ))}
                </div>
              </div>
              <div className="row-actions">
                {lockedV && (
                  <button className="btn sm" onClick={() => setStep('resume')}>View the resume you sent</button>
                )}
                <button className="btn sm" onClick={() => navigate('/tracker')}>All applications</button>
              </div>
            </>
          ) : s.status === 'cancelled' ? (
            <p className="muted">This application was cancelled.</p>
          ) : (
            <p className="muted">Not submitted yet.</p>
          )}
        </div>
      )}

      <div className="section">
        <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
          Timeline
          <button className="link-btn small" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : `Show (${d.events.length})`}</button>
        </h3>
        {showLog && (
          <div className="timeline card" style={{ padding: '8px 16px' }}>
            {d.events
              .filter((e) => e.type !== 'artifact.added')
              .slice()
              .reverse()
              .map((e) => (
                <div className="ev" key={e.id}>
                  <time title={new Date(e.at).toLocaleString()}>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  <span>
                    {EVENT_TEXT[e.type] ?? e.type.replace(/^status\./, '→ ').replace('_', ' ')}
                    {e.data?.error ? <span className="muted"> — {String(e.data.error)}</span> : null}
                    {e.type === 'stage.changed' && e.data?.stage ? <span className="muted"> — {String(e.data.stage)}</span> : null}
                    {e.type === 'fill.step' ? <span className="muted"> — {String(e.data?.fields)} fields, {String(e.data?.needs_you)} need you</span> : null}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
