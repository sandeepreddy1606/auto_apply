'use client'

/**
 * Telegram inbox: job posts from your Telegram groups (and pasted messages).
 * Separate from the career-page Jobs list.
 *
 * Each post applies the way it asks to:
 *   HR email     → the email is sent with your resume
 *   Google Form  → the form is filled from your profile and submitted
 *   Careers page → the automation browser fills the form with your PDF resume
 *                  and submits when everything is answered (live progress here)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useTelegramStatus } from '@/components/AppShell'
import { BoltIcon, BriefcaseIcon, ChevronRight, FormIcon, HelpIcon, LinkIcon, MailIcon, PinIcon, PlusSquare, SendIcon } from '@/components/Icons'
import GoogleSignIn from '@/components/GoogleSignIn'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { Application } from '@/lib/types'

const STATUS_CHIPS: [string, string][] = [
  ['all', 'All'],
  ['review', 'To apply'],
  ['applying', 'Applying'],
  ['applied', 'Applied'],
  ['failed', 'Failed'],
  ['manual', 'No apply method'],
  ['skipped', 'Skipped'],
]

const METHOD_LABEL: Record<string, string> = { email: 'HR email', gform: 'Google Form', link: 'Careers page', unknown: 'No apply method' }

function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const hostOf = (u: string | null) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

/** One tap applies it: it has a way to apply and isn't done or in progress. */
const isReady = (r: Application): boolean =>
  ['review', 'failed'].includes(r.status) &&
  ((r.method === 'email' && !!r.email_to) || (r.method === 'gform' && !!r.form_url) || (r.method === 'link' && !!r.apply_url))

/** A careers-page run that stopped for you (questions, sign-in, confirmation). */
const needsFinish = (r: Application): boolean => r.method === 'link' && !!r.session_id && r.status === 'review' && !!r.status_reason && !/press Apply/i.test(r.status_reason)

const MethodIcon = ({ method }: { method: string }) =>
  method === 'email' ? <MailIcon /> : method === 'gform' ? <FormIcon /> : method === 'link' ? <LinkIcon /> : <HelpIcon />

export default function ApplicationsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { tg } = useTelegramStatus()
  const [rows, setRows] = useState<Application[]>([])
  const [status, setStatus] = useState('all')
  const [group, setGroup] = useState('')
  const [q, setQ] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [applying, setApplying] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    try {
      const [data, st] = await Promise.all([
        api.listApplications({ status: status === 'all' ? '' : status, q }),
        api.stats().catch(() => null),
      ])
      setRows(data)
      if (st) setCounts({ all: st.total, ...st.by_status })
    } catch {
      /* backend warming up */
    } finally {
      setLoaded(true)
    }
  }, [status, q])

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  // Live: new posts arrive and careers-page runs report progress. Faster while
  // something is applying; paused during a click so a result isn't overwritten.
  const live = rows.some((r) => r.status === 'applying')
  useEffect(() => {
    const t = setInterval(() => {
      if (applying.size === 0 && !bulkBusy) void load()
    }, live ? 3000 : 10000)
    return () => clearInterval(t)
  }, [load, applying, bulkBusy, live])

  const groups = useMemo(() => [...new Set(rows.map((r) => r.channel).filter((c): c is string => !!c))].sort(), [rows])
  const shown = group ? rows.filter((r) => r.channel === group) : rows
  const ready = shown.filter(isReady)

  const setBusy = (id: number, on: boolean) =>
    setApplying((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const quickApply = async (r: Application) => {
    const what =
      r.method === 'email'
        ? `This sends the application email to ${r.email_to} with your resume.`
        : r.method === 'gform'
          ? 'This fills the Google Form from your profile and submits it. If a question can’t be answered, it opens for you instead.'
          : `This opens ${hostOf(r.apply_url) || 'the careers page'} in the automation browser, fills it with your PDF resume and profile, and submits when every required answer is filled.`
    if (!window.confirm(`Apply to “${r.job_title || 'this post'}”${r.company ? ` at ${r.company}` : ''}?\n\n${what}`)) return
    setBusy(r.id, true)
    try {
      const updated = await api.apply(r.id)
      if (updated.needs_input) {
        toast(`${updated.unanswered_required?.length ?? 'Some'} question(s) need you — opening the form.`, 'info')
        navigate(`/applications/${r.id}?apply=1`)
      } else if (updated.status === 'applied') {
        toast(`Applied to ${updated.job_title || 'the post'}.`, 'success')
      } else if (updated.status === 'applying') {
        toast('Applying on the careers page — progress shows on the post.', 'info')
      } else {
        toast(`Couldn’t apply: ${updated.error || updated.status_reason || 'unknown error'}`, 'error')
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(r.id, false)
      void load()
    }
  }

  const bulkApply = async () => {
    if (!ready.length) return
    const links = ready.filter((r) => r.method === 'link').length
    if (
      !window.confirm(
        `Apply to ${ready.length} post${ready.length > 1 ? 's' : ''} now?\n\n` +
          'Emails are sent, Google Forms submitted' +
          (links ? `, and ${links} careers page${links > 1 ? 's are' : ' is'} filled in the automation browser one after another` : '') +
          '. Anything that needs you stays open for you.',
      )
    ) {
      return
    }
    setBulkBusy(true)
    try {
      const res = await api.applyBatch(ready.map((r) => r.id))
      const bits = [`Applied to ${res.applied}`]
      if (res.started) bits.push(`${res.started} applying on careers pages`)
      if (res.needs_input) bits.push(`${res.needs_input} need your answers`)
      const failed = res.total - res.applied - (res.started ?? 0) - res.needs_input
      if (failed > 0) bits.push(`${failed} couldn’t be applied`)
      toast(`${bits.join(', ')}.`, failed > 0 ? 'error' : 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBulkBusy(false)
      void load()
    }
  }

  const checkGroups = async () => {
    setChecking(true)
    try {
      const r = await api.tgFetch()
      toast(r.created ? `${r.created} new job post${r.created === 1 ? '' : 's'}.` : 'No new job posts since the last check.', 'success')
      void load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <PageHeader
        large
        title="Telegram inbox"
        sub="Job posts from your Telegram groups. Apply sends the email, submits the form, or fills the careers page for you."
        actions={
          <>
            {tg.state === 'connected' && (tg.watched_chats?.length ?? 0) > 0 && (
              <button className="btn" disabled={checking} onClick={checkGroups}>
                {checking ? <span className="spin" /> : <SendIcon />} Check groups now
              </button>
            )}
            <button className="icon-btn" onClick={() => navigate('/paste')} title="Paste a job message" aria-label="Paste a job message">
              <PlusSquare />
            </button>
          </>
        }
      />

      {tg.state !== 'connected' || !(tg.watched_chats?.length) ? (
        <div className="warn-box" style={{ marginBottom: 14 }}>
          {tg.state !== 'connected' ? 'Telegram isn’t connected.' : 'No job groups are being watched.'}{' '}
          <button className="link-btn" onClick={() => navigate('/settings/telegram')}>
            {tg.state !== 'connected' ? 'Connect it and add your job groups' : 'Add a group by its name'}
          </button>
        </div>
      ) : null}

      {rows.some((r) => /needs your Google account/i.test(r.status_reason || '')) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Some Google Forms need your Google account</div>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Sign in once in the automation browser. Then press Apply on those posts and they’re filled and submitted
            with your account.
          </p>
          <GoogleSignIn />
        </div>
      )}

      {ready.length > 0 && (
        <div className="card bulk-bar">
          <div>
            <div className="bulk-title">{ready.length} post{ready.length > 1 ? 's' : ''} ready to apply</div>
            <div className="bulk-sub">
              {['email', 'gform', 'link']
                .map((m) => [m, ready.filter((r) => r.method === m).length] as const)
                .filter(([, n]) => n > 0)
                .map(([m, n]) => `${n} ${METHOD_LABEL[m].toLowerCase()}${n > 1 && m !== 'gform' ? 's' : n > 1 ? 's' : ''}`)
                .join(', ')}
            </div>
          </div>
          <button className="btn primary" disabled={bulkBusy || applying.size > 0} onClick={bulkApply}>
            {bulkBusy ? <span className="spin" /> : <BoltIcon fill="currentColor" strokeWidth={0} />} {bulkBusy ? 'Applying…' : 'Apply to all'}
          </button>
        </div>
      )}

      <div className="chips">
        {STATUS_CHIPS.map(([c, label]) => (
          <button key={c} className={`chip ${status === c ? 'active' : ''}`} onClick={() => setStatus(c)}>
            {label} {counts[c] > 0 && <span className="chip-n">{counts[c]}</span>}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search role, company, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.length > 1 && (
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          {!loaded ? (
            'Loading…'
          ) : q || status !== 'all' || group ? (
            'Nothing matches this filter.'
          ) : (
            <>
              <p style={{ marginBottom: 14 }}>No posts yet. Add a Telegram job group, or paste a post.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={() => navigate('/settings/telegram')}>Add a job group</button>
                <button className="btn" onClick={() => navigate('/paste')}>Paste a job post</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="app-list">
          {shown.map((r) => {
            const busy = applying.has(r.id)
            const reason = r.status === 'applying' || needsFinish(r) || r.status === 'failed' ? r.status_reason || r.error : null
            return (
              <div key={r.id} className={`card app-item ${r.status === 'applying' ? 'is-applying' : ''}`} onClick={() => navigate(`/applications/${r.id}`)}>
                <span className="method-ico" title={METHOD_LABEL[r.method]}>
                  <MethodIcon method={r.method} />
                </span>
                <div className="a-body">
                  <div className="a-title">{r.job_title || 'Untitled post'}</div>
                  <div className="meta post-meta">
                    {r.company && <span className="strong">{r.company}</span>}
                    {r.location && <span><PinIcon />{r.location}</span>}
                    {r.experience && <span><BriefcaseIcon />{r.experience}</span>}
                    {r.salary && <span className="pay">{r.salary}</span>}
                    {r.extra?.batch && <span>Batch {r.extra.batch.replace(/\s*\/\s*/g, ', ')}</span>}
                    {r.extra?.job_type && <span>{r.extra.job_type[0].toUpperCase() + r.extra.job_type.slice(1)}</span>}
                    {r.extra?.work_mode && <span>{r.extra.work_mode === 'onsite' ? 'On-site' : r.extra.work_mode[0].toUpperCase() + r.extra.work_mode.slice(1)}</span>}
                  </div>
                  {r.extra?.skills_list && r.extra.skills_list.length > 0 && (
                    <div className="post-skills">
                      {r.extra.skills_list.slice(0, 5).map((k) => <span key={k}>{k}</span>)}
                      {r.extra.skills_list.length > 5 && <span className="more">+{r.extra.skills_list.length - 5}</span>}
                    </div>
                  )}
                  <div className="a-sub">
                    <span className="a-method">{METHOD_LABEL[r.method]}{r.method === 'link' && hostOf(r.apply_url) ? `: ${hostOf(r.apply_url)}` : r.method === 'email' && r.email_to ? `: ${r.email_to}` : ''}</span>
                    {r.channel ? <span className="muted">  in {r.channel}</span> : null}
                  </div>
                  {reason && (
                    <div className={`a-reason ${r.status}`}>
                      {r.status === 'applying' && <span className="spin" />} {reason}
                    </div>
                  )}
                </div>
                <div className="a-side">
                  <span className={`badge ${r.status}`}>{STATUS_CHIPS.find(([k]) => k === r.status)?.[1] ?? r.status}</span>
                  <span className="a-time" title={r.posted_at ? `Posted ${new Date(r.posted_at).toLocaleString()}` : undefined}>{relTime(r.posted_at || r.created_at)}</span>
                </div>
                {needsFinish(r) ? (
                  <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); navigate(`/apply/${r.session_id}`) }}>Finish</button>
                ) : isReady(r) ? (
                  <button
                    className="btn sm apply-btn"
                    disabled={busy || bulkBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      void quickApply(r)
                    }}
                  >
                    {busy ? <span className="spin" /> : 'Apply'}
                  </button>
                ) : null}
                <ChevronRight style={{ width: 16, height: 16, color: 'var(--dim-2)', flexShrink: 0 }} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
