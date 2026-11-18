'use client'

import { useEffect, useState } from 'react'

import { timeAgo } from '@/components/career/ui'
import PageHeader from '@/components/PageHeader'
import { LoadError, SaveBar, useGuardedBack, useSection } from '@/components/settings/shared'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { AnswerBankEntry, ApplyAnswers } from '@/lib/types'

type Key = keyof ApplyAnswers
type FieldDef = { key: Key; label: string; kind?: 'select' | 'text'; options?: string[]; placeholder?: string }

const YN = ['', 'Yes', 'No']
const DECLINE = ['', 'Decline to self-identify']

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Work authorization',
    fields: [
      { key: 'citizenship', label: 'Citizenship', placeholder: 'e.g. Indian' },
      { key: 'authorized_india', label: 'Authorized to work in India?', kind: 'select', options: YN },
      { key: 'other_countries', label: 'Other countries you can work in', placeholder: 'e.g. none' },
      { key: 'sponsorship_now', label: 'Need visa sponsorship now?', kind: 'select', options: YN },
      { key: 'sponsorship_future', label: 'Need sponsorship in the future?', kind: 'select', options: YN },
    ],
  },
  {
    title: 'Availability',
    fields: [
      { key: 'notice_period', label: 'Notice period', kind: 'select', options: ['', 'Immediate', '15 days', '30 days', '60 days', '90 days'] },
      { key: 'start_date', label: 'Earliest start date', placeholder: 'e.g. Immediately / 2 weeks after offer' },
    ],
  },
  {
    title: 'Compensation',
    fields: [
      { key: 'currency', label: 'Currency', kind: 'select', options: ['INR', 'USD', 'EUR', 'GBP', 'SGD'] },
      { key: 'current_ctc', label: 'Current CTC', placeholder: 'e.g. 600000' },
      { key: 'expected_ctc', label: 'Expected CTC', placeholder: 'e.g. 1200000' },
      { key: 'salary_text', label: 'Wording for free-text salary questions', placeholder: 'Negotiable' },
    ],
  },
  {
    title: 'Work setup',
    fields: [
      { key: 'relocation', label: 'Willing to relocate?', kind: 'select', options: ['', 'Yes', 'No', 'Depends on location'] },
      { key: 'travel', label: 'Willing to travel', placeholder: 'e.g. up to 25%' },
    ],
  },
  {
    title: 'Voluntary disclosures (EEO)',
    fields: [
      { key: 'gender', label: 'Gender', kind: 'select', options: [...DECLINE, 'Male', 'Female', 'Non-binary'] },
      { key: 'pronouns', label: 'Pronouns', kind: 'select', options: [...DECLINE, 'he/him', 'she/her', 'they/them'] },
      { key: 'race', label: 'Race / ethnicity', kind: 'select', options: [...DECLINE, 'Asian', 'South Asian', 'Other'] },
      { key: 'veteran', label: 'Veteran status', kind: 'select', options: [...DECLINE, 'I am not a protected veteran', 'I am a veteran'] },
      { key: 'disability', label: 'Disability', kind: 'select', options: [...DECLINE, 'No, I do not have a disability', 'Yes, I have a disability'] },
    ],
  },
  {
    title: 'Common questions',
    fields: [
      { key: 'hear_about', label: 'How did you hear about us?', placeholder: 'Company careers page' },
      { key: 'languages', label: 'Languages you speak', placeholder: 'e.g. English, Telugu, Hindi' },
      { key: 'over_18', label: 'Over 18?', kind: 'select', options: YN },
      { key: 'background_check', label: 'Willing to do a background check?', kind: 'select', options: YN },
    ],
  },
]

export default function AnswersPage() {
  const [tab, setTab] = useState<'answers' | 'learned'>('answers')
  const back = useGuardedBack()
  return (
    <>
      <PageHeader title="Application answers" sub="Saved once, used to fill every application" onBack={back} />
      <div className="seg tabs multi">
        <button className={tab === 'answers' ? 'on' : ''} onClick={() => setTab('answers')}>Your answers</button>
        <button className={tab === 'learned' ? 'on' : ''} onClick={() => setTab('learned')}>Learned answers</button>
      </div>
      {tab === 'answers' ? <AnswersForm /> : <LearnedTab />}
    </>
  )
}

function AnswersForm() {
  const s = useSection<ApplyAnswers & Record<string, unknown>>('apply_answers', null)
  if (s.loadError) return <LoadError message={s.loadError} onRetry={s.load} />
  if (!s.data) return <p className="muted">Loading…</p>
  const a = s.data
  const askToggle = (k: Key) => (
    <label className="ask-toggle">
      <input type="checkbox" checked={a.always_ask.includes(k)} onChange={(e) => s.set('always_ask')(e.target.checked ? [...a.always_ask, k] : a.always_ask.filter((x) => x !== k))} />
      Always ask me
    </label>
  )
  return (
    <div className="settings-stack">
      <p className="muted small">
        Anything left blank (or set to “Always ask me”) is highlighted for you at review. Legal statements (“I certify…”) are never auto-ticked. EEO questions default to “Decline to self-identify”.
      </p>
      {GROUPS.map((g) => (
        <div className="card" key={g.title}>
          <h3>{g.title}</h3>
          <div className="answers-grid">
            {g.fields.map((f) => (
              <div key={f.key}>
                <label className="field">
                  <span className="lbl">{f.label}</span>
                  {f.kind === 'select' ? (
                    <select value={String(a[f.key] ?? '')} onChange={(e) => s.set(f.key)(e.target.value)}>
                      {f.options!.map((o) => <option key={o} value={o}>{o || '— not set —'}</option>)}
                    </select>
                  ) : (
                    <input value={String(a[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => s.set(f.key)(e.target.value)} />
                  )}
                </label>
                {askToggle(f.key)}
              </div>
            ))}
          </div>
          {g.title === 'Compensation' && (
            <label className="toggle" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={a.leave_salary_blank} onChange={(e) => s.set('leave_salary_blank')(e.target.checked)} />
              <span>Leave optional salary questions blank</span>
            </label>
          )}
          {g.title === 'Work setup' && (
            <div style={{ marginTop: 12 }}>
              <span className="lbl small muted">Work modes you accept</span>
              <div className="chips" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                {['Onsite', 'Hybrid', 'Remote'].map((m) => {
                  const on = a.work_modes.includes(m)
                  return <button key={m} className={`chip ${on ? 'active' : ''}`} onClick={() => s.set('work_modes')(on ? a.work_modes.filter((x) => x !== m) : [...a.work_modes, m])}>{m}</button>
                })}
              </div>
            </div>
          )}
        </div>
      ))}
      <button className="btn primary" style={{ padding: 15 }} disabled={s.saving || !s.dirty} onClick={s.save}>{s.saving ? 'Saving…' : s.dirty ? 'Save answers' : 'All changes saved'}</button>
      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount} onSave={s.save} onDiscard={s.discard} />
    </div>
  )
}

function LearnedTab() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [data, setData] = useState<{ items: AnswerBankEntry[]; stats: { answers: number; mappings: number } } | null>(null)
  const [edit, setEdit] = useState<Record<number, string>>({})
  const [nq, setNq] = useState('')
  const [na, setNa] = useState('')
  const load = () => career.bank(q || undefined).then(setData).catch((e) => toast((e as Error).message, 'error'))
  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="settings-stack">
      <p className="muted small">
        Every answer you type or correct during review is remembered here and reused for the same question next time.
        {data ? ` ${data.stats.answers} answers and ${data.stats.mappings} learned field mappings.` : ''}
      </p>
      <input type="search" placeholder="Search questions or answers" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card">
        <h3>Add an answer</h3>
        <div className="stack">
          <input placeholder="Question (as forms ask it)" value={nq} onChange={(e) => setNq(e.target.value)} />
          <textarea placeholder="Your answer" value={na} onChange={(e) => setNa(e.target.value)} style={{ minHeight: 70 }} />
          <div><button className="btn sm primary" disabled={!nq.trim() || !na.trim()} onClick={() => career.addBank(nq, na).then(() => { setNq(''); setNa(''); void load() }).catch((e) => toast((e as Error).message, 'error'))}>Add</button></div>
        </div>
      </div>
      {data?.items.length === 0 && <div className="empty">Nothing learned yet — it fills up as you review applications.</div>}
      {data?.items.map((e) => (
        <div className="card" key={e.id} style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <b className="small">{e.question_raw}</b>
            <span className="muted small nowrap">used {e.uses}×, last {timeAgo(e.last_used_at || e.created_at)}</span>
          </div>
          {e.id in edit ? (
            <>
              <textarea value={edit[e.id]} onChange={(ev) => setEdit({ ...edit, [e.id]: ev.target.value })} style={{ marginTop: 8, minHeight: 70 }} />
              <div className="row-actions" style={{ marginTop: 8 }}>
                <button className="btn sm primary" onClick={() => career.updateBank(e.id, { answer: edit[e.id] }).then(() => { const n = { ...edit }; delete n[e.id]; setEdit(n); void load() })}>Save</button>
                <button className="btn sm" onClick={() => { const n = { ...edit }; delete n[e.id]; setEdit(n) }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{e.answer}</p>
              <div className="row-actions" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => setEdit({ ...edit, [e.id]: e.answer })}>Edit</button>
                <button className="btn sm danger" onClick={() => window.confirm('Delete this answer?') && career.deleteBank(e.id).then(load)}>Delete</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
