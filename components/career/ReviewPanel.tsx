'use client'

import { useEffect, useMemo, useState } from 'react'

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
      {s.error && <div className={s.status === 'failed' ? 'err-box' : 'warn-box'} style={{ marginBottom: 12 }}>{s.error}</div>}
      {plan?.warnings.map((w, i) => <div key={i} className="warn-box" style={{ marginBottom: 8 }}>{w}</div>)}

      {(['resume_ready', 'failed', 'blocked', 'needs_input', 'reviewing'].includes(s.status)) && (
        <div className="row-actions" style={{ marginTop: 0, marginBottom: 12, alignItems: 'flex-start' }}>
          <GatedButton gate={d.gates.fill} busy={busy === 'fill'} className={s.status === 'resume_ready' || s.status === 'blocked' ? 'btn primary' : 'btn'} onClick={() => act('fill', () => career.fill(s.id))}>
            {s.status === 'resume_ready'
              ? 'Autofill the application'
              : s.status === 'blocked'
                ? 'Continue filling'
                : s.status === 'failed'
                  ? 'Try again'
                  : 'Re-fill from the start'}
          </GatedButton>
          <button className="btn sm" onClick={() => act('focus', () => career.focus(s.id))}>Show browser window</button>
          {s.status !== 'resume_ready' && (
            <button
              className="btn sm"
              title="You finished the form yourself in the browser window"
              onClick={() =>
                window.confirm('Mark this application as submitted? Only do this if you finished and sent it yourself in the browser window.') &&
                act('self', () => career.selfSubmitted(s.id), 'Marked as applied.')
              }
            >
              I submitted it myself
            </button>
          )}
          {!(plan && editable) && (
            <button className="btn sm danger" onClick={() => window.confirm('Cancel this application?') && act('cancel', () => career.cancel(s.id))}>
              Cancel
            </button>
          )}
        </div>
      )}
      {s.status === 'resume_ready' && !plan && (
        <p className="muted small" style={{ marginTop: -4, marginBottom: 12 }}>
          A browser window opens, fills the form from your profile and answers, attaches your resume and stops before submitting.
          Anything it can’t answer is listed here for you. If the site asks you to sign in, do it in that window and press “Continue filling”.
        </p>
      )}

      {working && (
        <div className="ok-box" style={{ marginBottom: 12 }}>
          <span className="spin" /> {s.status === 'filling' ? 'Filling the form in the automation browser — you can watch it.' : 'Submitting…'}
        </div>
      )}

      {s.status === 'unconfirmed' && (
        <div className="warn-box" style={{ marginBottom: 12 }}>
          <b>Did the application go through?</b> Check the automation browser window.
          <div className="row-actions">
            <button className="btn success sm" onClick={() => act('confirm', () => career.confirm(s.id, true), 'Marked as submitted.')}>Yes, it was submitted</button>
            <button className="btn sm" onClick={() => act('confirm', () => career.confirm(s.id, false))}>No, back to review</button>
            <button className="btn sm" onClick={() => act('focus', () => career.focus(s.id))}>Show browser window</button>
          </div>
        </div>
      )}

      {plan && (
        <div className="review-grid">
          <div>
            <div className="counts">
              <span className="pill ok">{counts.auto} from profile & resume</span>
              <span className="pill info">{counts.bank} learned</span>
              <span className="pill purple">{counts.draft} AI drafts</span>
              <span className={`pill ${counts.need ? 'bad' : 'ok'}`}>{counts.need} need you</span>
              {!plan.final_step_reached && <span className="pill warn">More steps ahead</span>}
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

          <div>
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

      {plan && (editable || s.status === 'reviewing') && (
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
