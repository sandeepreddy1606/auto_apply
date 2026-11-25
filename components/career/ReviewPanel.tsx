'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { ApplyDetail } from '@/lib/career-api'
import type { AnswerValue, FormField, PlannedAnswer } from '@/lib/types'

import { AuthedImage, GatedButton } from './ui'

const SRC: Record<string, [string, string]> = {
  resume: ['Resume', 'ok'],
  mapping: ['Learned', 'ok'],
  profile: ['Profile', 'ok'],
  answers: ['Your answers', 'ok'],
  answer_bank: ['Answer bank', 'info'],
  generated: ['AI draft', 'purple'],
  user: ['You', 'ok'],
  none: ['', ''],
}

function display(v: AnswerValue): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes (ticked)' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  return v.split(/[\\/]/).pop() && /\.pdf$/i.test(v) ? `Attached: ${v.split(/[\\/]/).pop()}` : v
}

function Editor({ f, value, onChange }: { f: FormField; value: AnswerValue; onChange: (v: AnswerValue) => void }) {
  if (f.kind === 'file') return <p className="fr-note">Attach a file in the automation browser window if needed.</p>
  if (f.kind === 'select' || f.kind === 'radio' || (f.kind === 'checkbox' && f.options.length > 1 && !f.multiple)) {
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {f.options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  if (f.kind === 'checkbox' && f.options.length > 1) {
    const cur = Array.isArray(value) ? value : []
    return (
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        {f.options.map((o) => (
          <label key={o} className="toggle small">
            <input type="checkbox" checked={cur.includes(o)} onChange={(e) => onChange(e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />
            <span>{o}</span>
          </label>
        ))}
      </div>
    )
  }
  if (f.kind === 'checkbox') {
    return (
      <label className="toggle small" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>Tick this box</span>
      </label>
    )
  }
  if (f.kind === 'textarea') return <textarea value={typeof value === 'string' ? value : ''} maxLength={f.max_length ?? undefined} onChange={(e) => onChange(e.target.value)} />
  return <input type={f.kind === 'date' ? 'date' : 'text'} value={typeof value === 'string' ? value : ''} maxLength={f.max_length ?? undefined} onChange={(e) => onChange(e.target.value)} />
}

export default function ReviewPanel({ d, reload }: { d: ApplyDetail; reload: () => void }) {
  const toast = useToast()
  const s = d.session
  const plan = s.fill_plan
  const [edits, setEdits] = useState<Record<string, AnswerValue>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const shots = d.artifacts.filter((a) => ['filled', 'edited', 'blocked', 'confirmation', 'after-submit', 'captcha', 'submit-error'].includes(a.kind))
  const [shot, setShot] = useState<number | null>(null)
  const latestShot = shots.at(-1)?.id ?? null
  useEffect(() => setShot(latestShot), [latestShot])

  // Drop local edits that the server has now applied.
  const planStamp = s.updated_at
  useEffect(() => setEdits({}), [planStamp])

  const rows = useMemo(() => {
    if (!plan) return []
    const order = (a: PlannedAnswer | undefined) => (a?.needs_you ? 0 : a?.source === 'generated' ? 1 : a?.confidence === 'medium' ? 2 : 3)
    return plan.fields
      .map((f) => ({ f, a: plan.answers[f.id] }))
      .sort((x, y) => order(x.a) - order(y.a) || x.f.step - y.f.step)
  }, [plan])

  const counts = useMemo(() => {
    const c = { need: 0, draft: 0, auto: 0, bank: 0 }
    for (const { a } of rows) {
      if (!a) continue
      if (a.needs_you) c.need++
      else if (a.source === 'generated') c.draft++
      else if (a.source === 'answer_bank' || a.source === 'mapping') c.bank++
      else if (a.value !== null && a.value !== '') c.auto++
    }
    return c
  }, [rows])

  const act = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name)
    try {
      await fn()
      if (ok) toast(ok, 'success')
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const applyEdits = () =>
    act('answers', () => career.answers(s.id, edits, remember), remember ? 'Answers applied and remembered.' : 'Answers applied.')

  const submit = () => {
    if (!window.confirm(`Submit your application to ${d.job?.company_name ?? 'this company'} now? This clicks the real submit button.`)) return
    void act('submit', () => career.submit(s.id))
  }

  const working = ['filling', 'submitting'].includes(s.status)
  const editable = ['reviewing', 'needs_input', 'blocked'].includes(s.status)
  const nEdits = Object.keys(edits).length

  return (
    <div>
      <NextStep
        d={d}
        busy={busy}
        nNeed={counts.need}
        onFill={() => act('fill', () => career.fill(s.id))}
        onFocus={() => act('focus', () => career.focus(s.id))}
        onSelf={() =>
          window.confirm('Mark this application as submitted? Only do this if you finished and sent it yourself in the browser window.') &&
          act('self', () => career.selfSubmitted(s.id), 'Marked as applied.')
        }
        onConfirm={(yes) => act('confirm', () => career.confirm(s.id, yes), yes ? 'Marked as submitted.' : undefined)}
        onCancel={() => window.confirm('Cancel this application?') && act('cancel', () => career.cancel(s.id))}
      />
      {plan?.warnings.map((w, i) => <div key={i} className="warn-box" style={{ marginBottom: 8 }}>{w}</div>)}

      {plan && (
        <div className={`review-grid ${rows.length ? '' : 'only-shot'}`}>
          {rows.length > 0 && (
          <div>
            <div className="counts">
              <span className="muted small">{rows.length} field{rows.length > 1 ? 's' : ''}:</span>
              {counts.auto > 0 && <span className="pill ok">{counts.auto} from profile & resume</span>}
              {counts.bank > 0 && <span className="pill info">{counts.bank} learned</span>}
              {counts.draft > 0 && <span className="pill purple">{counts.draft} AI drafts</span>}
              {counts.need > 0 && <span className="pill bad">{counts.need} need you</span>}
              {!plan.final_step_reached && <span className="pill warn">More pages ahead</span>}
            </div>
            <div className="field-list">
              {rows.map(({ f, a }) => {
                const val = f.id in edits ? edits[f.id] : (a?.value ?? null)
                const isOpen = open[f.id] || a?.needs_you || f.id in edits
                const [srcLabel, srcCls] = SRC[a?.source ?? 'none'] ?? ['', '']
                const cls = a?.needs_you && !(f.id in edits) ? 'need' : a?.source === 'generated' ? 'draft' : a?.confidence === 'medium' ? 'medium' : ''
                return (
                  <div key={f.id} className={`fr ${cls}`}>
                    <div className="fr-head">
                      <span className="fr-label">
                        {f.label || f.name || '(unlabelled field)'}
                        {f.required && <span style={{ color: 'var(--red)' }}> *</span>}
                      </span>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {f.step > 0 && <span className="pill">step {f.step + 1}</span>}
                        {srcLabel && <span className={`pill ${srcCls}`}>{srcLabel}</span>}
                        {editable && !isOpen && f.kind !== 'file' && (
                          <button className="link-btn small" onClick={() => setOpen({ ...open, [f.id]: true })}>Edit</button>
                        )}
                      </span>
                    </div>
                    {!isOpen && <div className="fr-val">{display(val)}</div>}
                    {a?.note && a.note !== 'pending-generation' && <div className="fr-note">{a.note}</div>}
                    {isOpen && editable && f.step === plan.step && (
                      <Editor f={f} value={val} onChange={(v) => setEdits({ ...edits, [f.id]: v })} />
                    )}
                    {isOpen && editable && f.step !== plan.step && <div className="fr-note">On an earlier page — change it in the browser window if needed.</div>}
                  </div>
                )
              })}
            </div>
          </div>
          )}

          <div>
            {!rows.length && <div className="shot-cap">What the site shows now</div>}
            {shot ? (
              <>
                <AuthedImage className="shot" src={`/api/artifacts/${shot}`} alt="Form screenshot" />
                {shots.length > 1 && (
                  <div className="shot-strip">
                    {shots.map((a) => (
                      <AuthedImage key={a.id} className={a.id === shot ? 'on' : ''} src={`/api/artifacts/${a.id}`} alt={a.kind} onClick={() => setShot(a.id)} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="pdf-empty">Screenshots appear here while the form is filled.</div>
            )}
          </div>
        </div>
      )}

      {plan && rows.length > 0 && (editable || s.status === 'reviewing') && (
        <div className="actionbar">
          {nEdits > 0 && (
            <>
              <label className="toggle small" style={{ marginRight: 'auto' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Remember these answers for next time</span>
              </label>
              <button className="btn sm" onClick={() => setEdits({})}>Discard</button>
              <button className="btn primary sm" disabled={busy === 'answers'} onClick={applyEdits}>
                Apply {nEdits} change{nEdits > 1 ? 's' : ''} to the form
              </button>
            </>
          )}
          {nEdits === 0 && (
            <>
              <button className="btn sm danger" onClick={() => window.confirm('Cancel this application?') && act('cancel', () => career.cancel(s.id))}>Cancel</button>
              <GatedButton gate={d.gates.submit} busy={busy === 'submit'} className="btn success" onClick={submit}>
                Submit application ▶
              </GatedButton>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The one thing to do next, for the state the application is in: a title,
 * why, one primary button, and quieter secondary actions.
 */
function NextStep({
  d,
  busy,
  nNeed,
  onFill,
  onFocus,
  onSelf,
  onConfirm,
  onCancel,
}: {
  d: ApplyDetail
  busy: string | null
  nNeed: number
  onFill: () => void
  onFocus: () => void
  onSelf: () => void
  onConfirm: (yes: boolean) => void
  onCancel: () => void
}) {
  const s = d.session
  const plan = s.fill_plan
  const fillBtn = (label: string, primary = true) => (
    <GatedButton gate={d.gates.fill} busy={busy === 'fill'} className={primary ? 'btn primary' : 'btn'} onClick={onFill}>
      {label}
    </GatedButton>
  )
  const show = <button className="btn" onClick={onFocus}>Show browser window</button>
  const self = <button className="btn ghost" title="You finished the form yourself in the browser window" onClick={onSelf}>I submitted it myself</button>
  const cancel = <button className="btn ghost danger-text" onClick={onCancel}>Cancel application</button>

  let tone = 'info'
  let title = ''
  let why: string | null = s.error
  let actions: ReactNode = null
  switch (s.status) {
    case 'resume_ready':
      title = 'Fill the application'
      why = 'A browser window opens, fills the form from your profile and answers, attaches your resume and stops before submitting. If the site asks you to sign in, do it there and press Continue filling.'
      actions = <>{fillBtn('Autofill the application')}{cancel}</>
      break
    case 'filling':
    case 'submitting':
      tone = 'working'
      title = s.status === 'filling' ? 'Filling the form…' : 'Submitting…'
      why = s.status === 'filling' ? 'Watch it in the automation browser window. Questions it can’t answer will be listed here.' : null
      actions = show
      break
    case 'blocked':
      tone = 'warn'
      title = 'Sign in on the site, then continue'
      why = s.error || 'The site needs you to sign in or create an account.'
      actions = <>{show}{fillBtn('Continue filling')}{self}</>
      break
    case 'needs_input':
      tone = 'warn'
      title = nNeed ? `Answer ${nNeed} open question${nNeed > 1 ? 's' : ''}` : 'Answer the open questions'
      why = s.error || 'They’re highlighted below. Your answers go into the form, and can be remembered for next time.'
      actions = <>{show}{self}</>
      break
    case 'reviewing':
      tone = 'ok'
      title = 'Check the answers and submit'
      why = plan?.final_step_reached === false ? 'The form has more pages; submitting moves on through them.' : 'Everything required is filled. Submit sends it to the company.'
      actions = <>{show}{self}</>
      break
    case 'unconfirmed':
      tone = 'warn'
      title = 'Did the application go through?'
      why = s.error || 'It was submitted, but no confirmation page appeared. Check the browser window.'
      actions = (
        <>
          <button className="btn primary" onClick={() => onConfirm(true)}>Yes, it was submitted</button>
          <button className="btn" onClick={() => onConfirm(false)}>No, back to review</button>
          {show}
        </>
      )
      break
    case 'failed':
      tone = 'bad'
      title = 'It stopped'
      why = s.error || 'Something went wrong while filling the form.'
      actions = <>{fillBtn('Try again')}{show}{self}{cancel}</>
      break
    default:
      return null
  }
  return (
    <section className={`next-step ${tone}`} aria-live="polite">
      <div className="ns-text">
        <h2 className="ns-title">{tone === 'working' && <span className="spin" />} {title}</h2>
        {why && <p className="ns-why">{why}</p>}
      </div>
      {actions && <div className="ns-actions">{actions}</div>}
    </section>
  )
}
