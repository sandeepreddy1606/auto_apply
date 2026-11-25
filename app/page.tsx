'use client'

/**
 * Overview: what changed, what needs you, and how the search is going.
 *
 *   Shortlist      the three best matches, each one tap from applying
 *   Figures        new matches, in progress, applied, interviews
 *   Needs you      applications waiting on an answer, a sign-in or a decision
 *   More matches   the next best-scoring open jobs
 *   New matches    jobs found per day, last 30 days (single series, hover for counts)
 *   Pipeline       found → started → applied → screening → interview → offer
 *   Get set up     only until the basics are done
 */
import { useEffect, useMemo, useState } from 'react'

import { NEXT_STEP, ScorePill } from '@/components/career/ui'
import {
  AlertIcon, ArrowRightIcon, BoltIcon, BriefcaseIcon, BuildingIcon, CheckIcon, ChevronRight, ClockIcon, PinIcon,
} from '@/components/Icons'
import { useToast } from '@/components/Toast'
import { useNavigate } from '@/components/Navigation'
import { useAuth } from '@/components/AuthProvider'
import { profileCompleteness } from '@/components/settings/shared'
import { api } from '@/lib/api'
import { career } from '@/lib/career-api'
import type { TrackerRow } from '@/lib/career-api'
import type { CompanyJobsSummary, JobListItem, Settings } from '@/lib/types'
import Monogram from '@/components/career/Monogram'

const DAY = 86_400_000

function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = Date.now() - Date.parse(iso)
  if (d < 3_600_000) return `${Math.max(1, Math.round(d / 60_000))}m`
  if (d < DAY) return `${Math.round(d / 3_600_000)}h`
  return `${Math.round(d / DAY)}d`
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** Applications that wait on you, with the next step (same wording as Applications). */
const TONE: Record<string, 'bad' | 'warn' | 'info'> = {
  needs_input: 'warn',
  blocked: 'warn',
  unconfirmed: 'bad',
  reviewing: 'info',
  failed: 'bad',
  resume_ready: 'info',
}

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<CompanyJobsSummary | null>(null)
  const [sessions, setSessions] = useState<TrackerRow[] | null>(null)
  const [top, setTop] = useState<JobListItem[] | null>(null)
  const [recent, setRecent] = useState<JobListItem[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hasPdf, setHasPdf] = useState(false)
  const [starting, setStarting] = useState<number | null>(null)
  const toast = useToast()

  // One tap from the shortlist straight into an application.
  const startApply = async (jobId: number) => {
    setStarting(jobId)
    try {
      const r = await career.startApply(jobId)
      for (const w of r.warnings) toast(w, 'info')
      navigate(`/apply/${r.session_id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setStarting(null)
    }
  }

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [cj, ss, tp, rc, se] = await Promise.all([
        api.companyJobsSummary().catch(() => null),
        career.sessions().catch(() => null),
        career.jobs({ view: 'relevant', sort: 'score', limit: 9 }).catch(() => null),
        career.jobs({ view: 'relevant', sort: 'newest', limit: 300 }).catch(() => null),
        api.getSettings().catch(() => null),
      ])
      if (!alive) return
      setSummary(cj)
      setSessions(ss ?? [])
      setTop(tp?.items ?? [])
      setRecent(rc?.items ?? [])
      setSettings(se)
      setHasPdf(Boolean(se?.resumes?.some((r) => /\.pdf$/i.test(r.stored))))
    }
    void load()
    const t = setInterval(load, 15000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const s = sessions ?? []
  const submitted = s.filter((x) => x.status === 'submitted')
  const inProgress = s.filter((x) => !['submitted', 'cancelled'].includes(x.status))
  const attention = s.filter((x) => x.status in TONE).slice(0, 6)
  const appliedTotal = submitted.length
  const appliedWeek = submitted.filter((x) => x.submitted_at && Date.now() - Date.parse(x.submitted_at) < 7 * DAY).length
  const responded = submitted.filter((x) => x.stage && ['screening', 'interview', 'offer'].includes(x.stage)).length
  const interviews = submitted.filter((x) => x.stage && ['interview', 'offer'].includes(x.stage)).length

  // New matches per day, last 30 days.
  const days = useMemo(() => {
    const out: { key: string; label: string; n: number }[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY)
      out.push({ key: d.toDateString(), label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), n: 0 })
    }
    const idx = new Map(out.map((d, i) => [d.key, i]))
    for (const j of recent) {
      const t = new Date(j.first_seen_at)
      t.setHours(0, 0, 0, 0)
      const i = idx.get(t.toDateString())
      if (i !== undefined) out[i].n++
    }
    return out
  }, [recent])
  const maxDay = Math.max(1, ...days.map((d) => d.n))
  const total30 = days.reduce((a, d) => a + d.n, 0)

  const pipeline: [string, number][] = [
    ['Matched', summary?.total_matched ?? 0],
    ['Started', s.filter((x) => x.status !== 'cancelled').length],
    ['Applied', submitted.length],
    ['Heard back', responded],
    ['Interview', interviews],
    ['Offer', submitted.filter((x) => x.stage === 'offer').length],
  ]
  const pipeMax = Math.max(1, ...pipeline.map(([, n]) => n))
  const RAMP = ['var(--viz-ramp-5)', 'var(--viz-ramp-4)', 'var(--viz-ramp-3)', 'var(--viz-ramp-2)', 'var(--viz-ramp-1)', 'var(--viz-ramp-1)']

  const p = settings?.profile
  const { filled, total } = profileCompleteness(p || {})
  const steps: { done: boolean; title: string; sub: string; to: string }[] = settings
    ? [
        { done: !!settings.job_prefs?.target_roles?.length, title: 'Choose your target roles', sub: 'Only matching titles count as relevant', to: '/settings/preferences' },
        { done: (summary?.companies ?? 0) > 0, title: 'Watch a company’s career page', sub: 'Amazon, Google, Microsoft or any ATS board', to: '/companies' },
        { done: hasPdf, title: 'Upload your resume PDF', sub: 'Lets you apply before installing LaTeX', to: '/settings/resumes' },
        { done: filled >= Math.min(total, 12), title: 'Complete your profile', sub: `${filled}/${total} fields — used to fill forms`, to: '/settings/profile' },
      ]
    : []
  const doneSteps = steps.filter((x) => x.done).length
  const firstName = (user?.name || '').trim().split(/\s+/)[0]

  return (
    <div className="dash wide">
      <header className="hero">
        <div className="hero-top">
          <div>
            <h1 className="hero-title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
            <p className="hero-sub">
              {summary?.new_matched
                ? `${summary.new_matched} new job${summary.new_matched > 1 ? 's' : ''} match your profile${attention.length ? `, and ${attention.length} application${attention.length > 1 ? 's' : ''} need${attention.length > 1 ? '' : 's'} you.` : '.'}`
                : attention.length
                  ? `${attention.length} application${attention.length > 1 ? 's' : ''} need${attention.length > 1 ? '' : 's'} you.`
                  : 'You’re all caught up.'}
            </p>
          </div>
          <div className="row-actions" style={{ marginTop: 0 }}>
            <button className="btn" onClick={() => navigate('/companies')}><BuildingIcon /> Companies</button>
            <button className="btn" onClick={() => navigate('/jobs')}><BriefcaseIcon /> All jobs</button>
          </div>
        </div>

        {top && top.length > 0 && (
          <section className="shortlist" aria-label="Best matches today">
            <h2 className="shortlist-title">Best matches today</h2>
            {top.slice(0, 3).map((j) => (
              <article key={j.id} className="pick">
                <ScorePill score={j.match_score} breakdown={j.match_breakdown} size="lg" />
                <button className="pick-body" onClick={() => navigate(`/jobs/${j.id}`)}>
                  <span className="pick-title">{j.title}</span>
                  <span className="meta">
                    <span className="strong">{j.company_name}</span>
                    {j.location && <span><PinIcon />{j.location.split(',')[0]}</span>}
                    {j.match_breakdown?.experience_range && <span>{j.match_breakdown.experience_range.replace(' y', ' years')}</span>}
                    <span><ClockIcon />{ago(j.posted_at || j.first_seen_at)} ago</span>
                  </span>
                  {j.match_breakdown && j.match_breakdown.skills_have.length > 0 && (
                    <span className="pick-why">You have {j.match_breakdown.skills_have.slice(0, 4).map((k, i) => <span key={k}>{i ? ' ' : ''}<span className="mark soft">{k}</span></span>)}</span>
                  )}
                </button>
                <div className="pick-actions">
                  {j.session_id ? (
                    <button className="btn" onClick={() => navigate(`/apply/${j.session_id}`)}>Continue</button>
                  ) : (
                    <button className="btn primary" disabled={starting === j.id} onClick={() => void startApply(j.id)}>
                      {starting === j.id ? <span className="spin" /> : <BoltIcon fill="currentColor" strokeWidth={0} />} Apply
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}

        <dl className="figures">
          <button onClick={() => navigate('/jobs')}><dt>New matches</dt><dd>{summary ? summary.new_matched : '–'}</dd></button>
          <button onClick={() => navigate('/tracker')}><dt>In progress</dt><dd>{sessions ? inProgress.length : '–'}</dd>{attention.length > 0 && <em className="warn">{attention.length} need you</em>}</button>
          <button onClick={() => navigate('/tracker')}><dt>Applied</dt><dd>{sessions ? appliedTotal : '–'}</dd>{appliedWeek > 0 ? <em className="good">{appliedWeek} this week</em> : sessions && appliedTotal === 0 && <em>Submit one to start</em>}</button>
          <button onClick={() => navigate('/tracker')}><dt>Interviews</dt><dd>{sessions ? interviews : '–'}</dd>{submitted.length > 0 ? <em>{Math.round((responded / submitted.length) * 100)}% heard back</em> : sessions && <em>Tracked once you apply</em>}</button>
        </dl>
      </header>

      <div className="dash-grid">
        <div className="dash-col">
          <section className={`card needs-card ${attention.length ? "has-items" : ""}`}>
            <div className="card-head">
              <div>
                <div className="card-title">Needs you</div>
                <div className="card-sub">Applications waiting on an answer, a sign-in or a decision</div>
              </div>
              <button className="card-link" onClick={() => navigate('/tracker')}>All applications <ChevronRight /></button>
            </div>
            {attention.length === 0 ? (
              <div className="empty-state" style={{ padding: '18px 0 8px' }}>
                <span className="es-icon"><CheckIcon /></span>
                <b>Nothing needs you</b>
                <p>Start an application from a job you like — the browser fills the form and stops before submitting.</p>
              </div>
            ) : (
              <div className="attn">
                {attention.map((x) => {
                  const label = NEXT_STEP[x.status] ?? ''
                  const tone = TONE[x.status]
                  return (
                    <button key={x.id} className="attn-row" onClick={() => navigate(`/apply/${x.id}`)}>
                      <Monogram name={x.company_name} />
                      <span className="at-body">
                        <div className="at-title">{x.job_title}</div>
                        <div className="at-sub"><span className={`at-reason ${tone}`}>{label}. </span>{x.company_name}, updated {ago(x.updated_at)} ago</div>
                      </span>
                      <span className={`pill ${tone}`}>{tone === 'bad' && <AlertIcon style={{ width: 12, height: 12 }} />}{label}</span>
                      <ChevronRight />
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <div className="card-title">More matches</div>
                <div className="card-sub">Next best fits for your roles, skills and experience</div>
              </div>
              <button className="card-link" onClick={() => navigate('/jobs')}>See all <ChevronRight /></button>
            </div>
            {top === null ? (
              <div className="skeleton" style={{ height: 180 }} />
            ) : top.length === 0 ? (
              <div className="empty-state" style={{ padding: '18px 0 8px' }}>
                <span className="es-icon"><BriefcaseIcon /></span>
                <b>No matches yet</b>
                <p>Two steps fill this: choose the roles you want, and watch a few companies. Matching jobs then appear here.</p>
                <div className="row-actions" style={{ marginTop: 6, justifyContent: 'center' }}>
                  <button className="btn primary sm" onClick={() => navigate('/jobs')}>Choose roles</button>
                  <button className="btn sm" onClick={() => navigate('/companies')}>Add suggested companies</button>
                </div>
              </div>
            ) : top.length <= 3 ? (
              <p className="muted small">The shortlist above is everything above your relevance threshold right now.</p>
            ) : (
              <div>
                {top.slice(3).map((j) => (
                  <button key={j.id} className="match-row" onClick={() => navigate(`/jobs/${j.id}`)}>
                    <ScorePill score={j.match_score} breakdown={j.match_breakdown} size="sm" />
                    <span style={{ minWidth: 0 }}>
                      <div className="mr-title">{j.title}</div>
                      <div className="mr-sub">{j.company_name}{j.location ? `, ${j.location.split(',')[0]}` : ''}</div>
                    </span>
                    <span className="mr-time">{ago(j.posted_at || j.first_seen_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="dash-col">
          {steps.length > 0 && doneSteps < steps.length && (
            <section className="card">
              <div className="card-head" style={{ marginBottom: 6 }}>
                <div>
                  <div className="card-title">Get set up</div>
                  <div className="card-sub">{doneSteps} of {steps.length} done</div>
                </div>
              </div>
              <div className="progress-line"><i style={{ width: `${(doneSteps / steps.length) * 100}%` }} /></div>
              <div className="setup-list">
                {steps.map((st) => (
                  <button key={st.title} className={`setup-step ${st.done ? 'done' : ''}`} onClick={() => navigate(st.to)}>
                    <span className={`ck ${st.done ? 'done' : ''}`}>{st.done && <CheckIcon />}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div className="ss-title">{st.title}</div>
                      {!st.done && <div className="ss-sub">{st.sub}</div>}
                    </span>
                    {!st.done && <ArrowRightIcon style={{ width: 15, height: 15, color: 'var(--dim-2)' }} />}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <div>
                <div className="card-title">New matches per day</div>
                <div className="card-sub">{total30} found in the last 30 days</div>
              </div>
            </div>
            {total30 === 0 ? (
              <p className="quiet-note">
                Nothing new matched this month. Watching more companies widens the net —{' '}
                <button className="link-btn" onClick={() => navigate('/companies')}>add suggested companies</button>.
              </p>
            ) : (
            <>
            <div className="bars" role="img" aria-label={`New matching jobs per day over the last 30 days, ${total30} in total`}>
              {days.map((d) => (
                <div key={d.key} className={`bar-col ${d.n ? '' : 'zero'}`}>
                  <i style={{ height: `${d.n ? Math.max(4, (d.n / maxDay) * 100) : 2}%` }} />
                  <span className="tip"><b>{d.n}</b> new on {d.label}</span>
                </div>
              ))}
            </div>
            <div className="bars-base" />
            <div className="bars-axis"><span>{days[0]?.label}</span><span>{days[14]?.label}</span><span>Today</span></div>
            <table className="sr-only">
              <caption>New matching jobs per day</caption>
              <tbody>{days.filter((d) => d.n).map((d) => <tr key={d.key}><th>{d.label}</th><td>{d.n}</td></tr>)}</tbody>
            </table>
            </>
            )}
          </section>

          {submitted.length > 0 && (
          <section className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Pipeline</div>
                <div className="card-sub">From match to offer</div>
              </div>
            </div>
            <div className="pipeline">
              {pipeline.map(([label, n], i) => (
                <div className="pipe-row" key={label}>
                  <span className="p-label">{label}</span>
                  <span className="pipe-track"><i style={{ width: `${n ? Math.max(1.5, (n / pipeMax) * 100) : 0}%`, background: RAMP[i] }} /></span>
                  <span className="p-n">{n}</span>
                </div>
              ))}
            </div>
          </section>
          )}
        </div>
      </div>
    </div>
  )
}
