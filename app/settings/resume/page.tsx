'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'

import { ChipInput } from '@/components/career/ui'
import PageHeader from '@/components/PageHeader'
import { LoadError, SaveBar, useGuardedBack, useSection } from '@/components/settings/shared'
import { useToast } from '@/components/Toast'
import { authedBlobUrl, career } from '@/lib/career-api'
import type { BaseWithMeta } from '@/lib/career-api'
import type { FactBank, FactOverlay, ResumeIssue, ResumePrefs } from '@/lib/types'

const LatexEditor = dynamic(() => import('@/components/career/LatexEditor'), { ssr: false, loading: () => <div className="cm-host skeleton" /> })

type Tab = 'bases' | 'issues' | 'facts' | 'skills' | 'output'
const TABS: [Tab, string][] = [
  ['bases', 'Base resume'],
  ['issues', 'Issues'],
  ['facts', 'Fact bank'],
  ['skills', 'Skills inventory'],
  ['output', 'Output'],
]

export default function ResumeSettingsPage() {
  const [tab, setTab] = useState<Tab>('bases')
  const [bases, setBases] = useState<BaseWithMeta[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const back = useGuardedBack()

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(([k]) => k === t)) setTab(t)
  }, [])
  const loadBases = useCallback(() => career.bases().then(setBases).catch((e) => setErr((e as Error).message)), [])
  useEffect(() => {
    void loadBases()
  }, [loadBases])

  const def = bases?.find((b) => b.is_default === 1) ?? bases?.[0]
  const issueCount = def ? def.issues.block + def.issues.warn : 0

  return (
    <div className="wide">
      <PageHeader title="Resume" sub="Your base LaTeX resume, its facts, and how tailored versions are built" onBack={back} />
      <div className="tabs seg multi">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {k === 'issues' && def && issueCount > 0 && <span className="seg-badge" style={{ background: def.issues.block ? 'var(--red)' : 'var(--amber)' }}>{issueCount}</span>}
          </button>
        ))}
      </div>
      {err && <div className="err-box">{err}</div>}
      {tab === 'bases' && <BasesTab bases={bases} reload={loadBases} />}
      {tab === 'issues' && (def ? <IssuesTab baseId={def.id} onChanged={loadBases} /> : <NoBase />)}
      {tab === 'facts' && (def ? <FactsTab baseId={def.id} /> : <NoBase />)}
      {tab === 'skills' && (def ? <SkillsTab baseId={def.id} /> : <NoBase />)}
      {tab === 'output' && <OutputTab />}
    </div>
  )
}

const NoBase = () => <div className="empty">Add your base resume first (Base resume tab).</div>

// ---------------------------------------------------------------- bases

function BasesTab({ bases, reload }: { bases: BaseWithMeta[] | null; reload: () => void }) {
  const toast = useToast()
  const [sel, setSel] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [orig, setOrig] = useState('')
  const [name, setName] = useState('')
  const [pdf, setPdf] = useState<{ url: string; n: number } | null>(null)
  const [compileErr, setCompileErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (bases && !sel && bases.length) setSel((bases.find((b) => b.is_default) ?? bases[0]).id)
  }, [bases, sel])
  const cur = bases?.find((b) => b.id === sel)
  useEffect(() => {
    if (cur) {
      setDraft(cur.latex)
      setOrig(cur.latex)
      setName(cur.name)
      setPdf(null)
      setCompileErr(null)
    }
  }, [cur?.id, cur?.latex]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!cur) return
    setBusy('save')
    try {
      await career.updateBase(cur.id, { latex: draft, name })
      toast('Base saved. Issues and facts were re-checked.', 'success')
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  const preview = async () => {
    if (!cur) return
    if (draft !== orig) await save()
    setBusy('compile')
    setCompileErr(null)
    try {
      const r = await authedBlobUrl(`/api/resume/bases/${cur.id}/compile`, { method: 'POST' })
      setPdf({ url: r.url, n: Number(r.headers.get('X-Pages') || 0) })
    } catch (e) {
      setCompileErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const upload = async (file: File) => {
    const text = await file.text()
    try {
      const b = await career.createBase(file.name.replace(/\.tex$/i, ''), text, !bases?.length)
      toast('Base resume added.', 'success')
      setSel(b.id)
      setAdding(false)
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const undo = async () => {
    if (!cur) return
    try {
      await career.updateBase(cur.id, { undo: true })
      toast('Restored the previous version.', 'success')
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (!bases) return <div className="skeleton" />
  if (!bases.length || adding) {
    return (
      <div className="card">
        <h3>Add your base resume</h3>
        <p className="muted small" style={{ margin: '6px 0 12px' }}>Upload your .tex file or paste the LaTeX. It stays on your machine.</p>
        <input type="file" accept=".tex,text/plain" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <textarea style={{ marginTop: 12, minHeight: 200, fontFamily: 'var(--mono)', fontSize: 12 }} placeholder="…or paste \documentclass … \end{document}" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="row-actions">
          <button className="btn primary" disabled={!draft.includes('\\begin{document}')} onClick={() => career.createBase('Base resume', draft, !bases.length).then((b) => { setSel(b.id); setAdding(false); reload() }).catch((e) => toast((e as Error).message, 'error'))}>
            Save base resume
          </button>
          {bases.length > 0 && <button className="btn" onClick={() => setAdding(false)}>Cancel</button>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="version-bar">
        <select value={sel ?? ''} onChange={(e) => setSel(Number(e.target.value))}>
          {bases.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}{b.is_default ? ' (default)' : ''}{b.issues.block ? ` · ${b.issues.block} to fix` : ''}
            </option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} aria-label="Name" />
        {cur && !cur.is_default && <button className="btn sm" onClick={() => career.updateBase(cur.id, { make_default: true }).then(reload)}>Make default</button>}
        <button className="btn sm" onClick={() => setAdding(true)}>+ Add another</button>
        {cur && cur.history > 0 && <button className="btn sm" onClick={undo}>Undo last change ({cur.history})</button>}
        {cur && bases.length > 1 && <button className="btn sm danger" onClick={() => window.confirm(`Delete “${cur.name}”?`) && career.deleteBase(cur.id).then(() => { setSel(null); reload() })}>Delete</button>}
      </div>
      <div className="studio" style={{ gridTemplateColumns: undefined }}>
        <div className="pane" style={{ display: 'block' }}>
          <LatexEditor value={draft} onChange={setDraft} onSave={save} />
          <div className="row-actions">
            <button className="btn primary sm" disabled={draft === orig || busy === 'save'} onClick={save}>Save (Ctrl+S)</button>
            <button className="btn sm" disabled={busy === 'compile'} onClick={preview}>{busy === 'compile' ? <span className="spin" /> : null} Compile preview</button>
          </div>
        </div>
        <div className="pane" style={{ display: 'block' }}>
          {compileErr ? <div className="err-box">{compileErr}</div> : pdf ? (
            <>
              <iframe className="pdf-frame" src={`${pdf.url}#view=FitH`} title="Base resume preview" />
              <p className="muted small">{pdf.n} page(s)</p>
            </>
          ) : (
            <div className="pdf-empty">Press “Compile preview” to render your base.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- issues

function IssuesTab({ baseId, onChanged }: { baseId: number; onChanged: () => void }) {
  const toast = useToast()
  const [issues, setIssues] = useState<ResumeIssue[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    career.issues(baseId).then((r) => setIssues(r.issues)).catch((e) => toast((e as Error).message, 'error'))
  }, [baseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (i: ResumeIssue, action: string) => {
    setBusy(`${i.id}:${action}`)
    try {
      const r = await career.resolveIssue(baseId, i.id, action, values[i.id] ?? '')
      setIssues(r.issues)
      onChanged()
      toast(action === 'dismiss' ? 'Dismissed.' : 'Fixed in your base resume.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!issues) return <div className="skeleton" />
  if (!issues.length) return <div className="ok-box">No issues — your base resume is ready to tailor.</div>
  const blocking = issues.filter((i) => i.severity === 'block').length
  return (
    <div className="stack">
      {blocking > 0 ? (
        <div className="warn-box">{blocking} issue{blocking > 1 ? 's' : ''} must be fixed before generating or submitting. Every fix edits your base, and you can undo it from the Base resume tab.</div>
      ) : (
        <div className="ok-box">Nothing blocking. The rest are suggestions.</div>
      )}
      {issues.map((i) => (
        <div key={i.id} className={`issue ${i.severity}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <b style={{ fontSize: 14 }}>{i.title}</b>
            <span className={`pill ${i.severity === 'block' ? 'bad' : i.severity === 'warn' ? 'warn' : 'info'}`}>
              {i.severity === 'block' ? 'Must fix' : i.severity === 'warn' ? 'Suggested' : 'Tip'}{i.line ? ` · line ${i.line}` : ''}
            </span>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>{i.detail}</p>
          {i.context && <div className="ctx">{i.context}</div>}
          <div className="acts">
            {i.actions.some((a) => a.needs_value) && (
              <input
                type={i.actions.find((a) => a.needs_value)?.input === 'number' ? 'number' : 'text'}
                step="any"
                placeholder={i.actions.find((a) => a.needs_value)?.placeholder}
                value={values[i.id] ?? ''}
                onChange={(e) => setValues({ ...values, [i.id]: e.target.value })}
              />
            )}
            {i.actions.map((a) => (
              <button key={a.id} className={`btn sm ${a.needs_value || a.id === 'confirm' || a.id === 'fix' ? 'primary' : ''} ${a.id === 'remove' ? 'danger' : ''}`} disabled={!!busy || (a.needs_value && !(values[i.id] ?? '').trim())} onClick={() => act(i, a.id)}>
                {busy === `${i.id}:${a.id}` ? <span className="spin" /> : null} {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- facts

function FactsTab({ baseId }: { baseId: number }) {
  const toast = useToast()
  const [facts, setFacts] = useState<FactBank | null>(null)
  const [overlay, setOverlay] = useState<FactOverlay | null>(null)
  const [adding, setAdding] = useState<Record<string, string>>({})
  useEffect(() => {
    career.facts(baseId).then((r) => { setFacts(r.facts); setOverlay(r.overlay) }).catch((e) => toast((e as Error).message, 'error'))
  }, [baseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveExtra = async (entryId: string, list: { id: string; text: string }[]) => {
    if (!overlay) return
    const next = { ...overlay, extra_bullets: { ...overlay.extra_bullets, [entryId]: list } }
    try {
      const r = await career.saveOverlay(baseId, next)
      setFacts(r.facts)
      setOverlay(r.overlay)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (!facts || !overlay) return <div className="skeleton" />
  const entries = [...facts.experience, ...facts.projects]
  return (
    <div>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Read from your base resume. Tailoring may only select and rephrase these facts. Add <b>extra bullets</b> that are true but don’t fit on the page: the AI can choose them for relevant jobs.
      </p>
      {entries.map((e) => {
        const extras = overlay.extra_bullets[e.id] ?? []
        return (
          <div key={e.id} className="fact-entry">
            <h4>{e.title}{e.org ? ` — ${e.org}` : ''} <span className="muted small">{e.dates}</span></h4>
            <ul>
              {e.bullets.filter((b) => !b.extra).map((b) => (
                <li key={b.id} className="fb">
                  {b.text}
                  <div className="tags">
                    {b.metrics.map((m) => <span key={m}>#{m}</span>)}
                    {b.skills.map((k) => <span key={k}>{k}</span>)}
                  </div>
                </li>
              ))}
              {extras.map((x) => (
                <li key={x.id} className="fb" style={{ color: 'var(--purple)' }}>
                  {x.text} <button className="link-btn small" onClick={() => saveExtra(e.id, extras.filter((y) => y.id !== x.id))}>remove</button>
                </li>
              ))}
            </ul>
            <div className="acts" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input placeholder="Add a true bullet for this entry (not printed on the base)" value={adding[e.id] ?? ''} onChange={(ev) => setAdding({ ...adding, [e.id]: ev.target.value })} />
              <button className="btn sm" disabled={!(adding[e.id] ?? '').trim()} onClick={() => {
                const n = Math.max(0, ...extras.map((x) => Number(x.id.slice(1)) || 0)) + 1
                void saveExtra(e.id, [...extras, { id: `x${n}`, text: adding[e.id].trim() }])
                setAdding({ ...adding, [e.id]: '' })
              }}>Add</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- skills

function SkillsTab({ baseId }: { baseId: number }) {
  const toast = useToast()
  const [facts, setFacts] = useState<FactBank | null>(null)
  const [overlay, setOverlay] = useState<FactOverlay | null>(null)
  useEffect(() => {
    career.facts(baseId).then((r) => { setFacts(r.facts); setOverlay(r.overlay) }).catch((e) => toast((e as Error).message, 'error'))
  }, [baseId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!facts || !overlay) return <div className="skeleton" />
  const save = async (inventory: string[]) => {
    try {
      const r = await career.saveOverlay(baseId, { ...overlay, inventory_extra: inventory })
      setOverlay(r.overlay)
      setFacts(r.facts)
      toast('Saved — jobs are being re-scored.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className="settings-stack">
      <div className="card">
        <h3>Skills on your resume</h3>
        {facts.skills.map((g) => (
          <p key={g.category} className="small" style={{ marginTop: 6 }}><b>{g.category}:</b> <span className="muted">{g.items.join(', ')}</span></p>
        ))}
      </div>
      <div className="card">
        <h3>Extra skills you genuinely have</h3>
        <p className="muted small" style={{ margin: '4px 0 10px' }}>
          Adding a skill here means “I confirm I have this”. Only then may tailoring add it to the Skills section. It also counts in job scores.
        </p>
        <ChipInput value={overlay.inventory_extra} onChange={save} placeholder="e.g. Kafka, Kubernetes, TypeScript" suggestions={['TypeScript', 'Kubernetes', 'Redis', 'Kafka', 'PostgreSQL', 'GraphQL', 'Terraform', 'Linux']} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- output

function OutputTab() {
  const s = useSection<ResumePrefs & Record<string, unknown>>('resume_prefs', null)
  if (s.loadError) return <LoadError message={s.loadError} onRetry={s.load} />
  if (!s.data) return <div className="skeleton" />
  const p = s.data
  return (
    <div className="settings-stack" style={{ maxWidth: 760 }}>
      <div className="card">
        <div className="stack">
          <label className="field">
            <span className="lbl">Maximum pages</span>
            <div className="seg">
              {[1, 2].map((n) => <button key={n} className={p.max_pages === n ? 'on' : ''} onClick={() => s.set('max_pages')(n)}>{n} page{n > 1 ? 's' : ''}</button>)}
            </div>
          </label>
          <label className="field">
            <span className="lbl">Tailoring style</span>
            <select value={p.style} onChange={(e) => s.set('style')(e.target.value)}>
              <option value="conservative">Conservative — reorder, light rephrasing</option>
              <option value="balanced">Balanced — rephrase to surface keywords (recommended)</option>
              <option value="assertive">Assertive — more rewording (still fact-checked)</option>
            </select>
          </label>
          <label className="field">
            <span className="lbl">Projects to include</span>
            <select value={p.projects_count} onChange={(e) => s.set('projects_count')(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={p.rewrite_summary} onChange={(e) => s.set('rewrite_summary')(e.target.checked)} /><span>Rewrite the summary for each job</span></label>
          <label className="field">
            <span className="lbl">PDF file name ({'{First}'}, {'{Last}'})</span>
            <input value={p.filename_pattern} onChange={(e) => s.set('filename_pattern')(e.target.value)} />
          </label>
          <label className="field">
            <span className="lbl">Warn when a bullet is reworded more than {p.drift_threshold}%</span>
            <input type="range" min={20} max={100} value={p.drift_threshold} onChange={(e) => s.set('drift_threshold')(Number(e.target.value))} style={{ padding: 0, border: 0, background: 'none' }} />
          </label>
        </div>
      </div>
      <button className="btn primary" style={{ padding: 15 }} disabled={s.saving || !s.dirty} onClick={s.save}>{s.saving ? 'Saving…' : s.dirty ? 'Save output settings' : 'All changes saved'}</button>
      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount} onSave={s.save} onDiscard={s.discard} />
    </div>
  )
}

