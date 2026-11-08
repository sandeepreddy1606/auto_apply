'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'

import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { ApplyDetail } from '@/lib/career-api'
import type { ResumeVersion } from '@/lib/types'

import { GatedButton, PdfView, timeAgo } from './ui'

const LatexEditor = dynamic(() => import('./LatexEditor'), {
  ssr: false,
  loading: () => <div className="cm-host skeleton" />,
})

const VLABEL: Record<string, string> = { base: 'Base copy', llm: 'AI tailored', user: 'Your edit' }

export default function ResumeStudio({ d, reload }: { d: ApplyDetail; reload: () => void }) {
  const toast = useToast()
  const sid = d.session.id
  const locked = d.versions.find((v) => v.status === 'locked')
  const [vid, setVid] = useState<number | null>(locked?.id ?? d.versions[0]?.id ?? null)
  const [v, setV] = useState<ResumeVersion | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [hint, setHint] = useState('')
  const [tab, setTab] = useState<'edit' | 'pdf' | 'report'>('pdf')
  const [jump, setJump] = useState<{ line: number; n: number } | null>(null)
  const [manual, setManual] = useState<{ prompt: string; reason: string | null } | null>(null)
  const [answer, setAnswer] = useState('')

  // New versions (generation finished, edits saved) appear at the top: follow them.
  const newest = d.versions[0]?.id
  useEffect(() => {
    if (newest && (!vid || newest > vid)) setVid(newest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest])

  const meta = d.versions.find((x) => x.id === vid)
  const metaStamp = meta ? `${meta.status}:${meta.page_count}:${meta.compile_log?.ok}` : ''
  useEffect(() => {
    if (!vid) return
    career
      .version(vid)
      .then((x) => {
        setV(x)
        setDraft(x.latex)
      })
      .catch((e) => toast((e as Error).message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid, metaStamp])

  // First open: compile the base copy so you see a PDF right away.
  useEffect(() => {
    if (v && v.generated_by === 'base' && !v.compile_log && v.status === 'draft' && !busy) void compile(v.id, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id])

  useEffect(() => {
    if (v?.status === 'awaiting_manual') career.manualPrompt(v.id).then(setManual).catch(() => setManual(null))
    else setManual(null)
  }, [v?.id, v?.status])

  const dirty = !!v && draft !== v.latex
  const errLines = useMemo(() => (v?.compile_log?.errors ?? []).map((e) => e.line).filter((x): x is number => !!x), [v])

  async function compile(id: number, announce = true) {
    setBusy('compile')
    try {
      const nv = await career.compileVersion(id)
      setV(nv)
      if (announce) toast(nv.compile_log?.ok ? `Compiled · ${nv.page_count} page(s)` : 'Compile failed — see errors', nv.compile_log?.ok ? 'success' : 'error')
      if (!nv.compile_log?.ok) setTab('report')
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const saveAndCompile = async () => {
    if (!v) return
    setBusy('compile')
    try {
      let target = v
      if (dirty) {
        target = await career.saveVersion(v.id, draft)
        if (target.id !== v.id) setVid(target.id)
      }
      setBusy(null)
      await compile(target.id)
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(null)
    }
  }

  const generate = async () => {
    setBusy('generate')
    try {
      const r = await career.generate(sid, hint)
      setVid(r.version_id)
      setHint('')
      toast('Tailoring your resume — usually under a minute.', 'info')
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const lock = async () => {
    if (!v) return
    if (dirty) return toast('Save & compile your edits first.', 'error')
    setBusy('lock')
    try {
      await career.lock(sid, v.id)
      toast('Resume locked to this application.', 'success')
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const sendManual = async () => {
    if (!v) return
    setBusy('manual')
    try {
      await career.manualAnswer(v.id, answer)
      setAnswer('')
      toast('Got it — building the resume…', 'info')
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const reuse = async (id: number) => {
    try {
      const r = await career.reuse(sid, id)
      setVid(r.version_id)
      reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const rep = v?.ats_report
  const guard = v?.guard_report
  const generating = v?.status === 'generating'
  const lockGate = dirty ? { ok: false, reason: 'Save & compile your edits first.', fix: null } : v?.compile_log?.ok ? { ok: true, reason: null, fix: null } : d.gates.lock

  return (
    <div>
      <div className="version-bar">
        <select value={vid ?? ''} onChange={(e) => setVid(Number(e.target.value))} aria-label="Resume version">
          {d.versions.map((x) => (
            <option key={x.id} value={x.id}>
              v{x.id} · {VLABEL[x.generated_by] ?? x.generated_by}
              {x.status === 'locked' ? ' · 🔒 locked' : x.status === 'generating' ? ' · generating…' : x.status === 'awaiting_manual' ? ' · waiting for answer' : x.status === 'failed' ? ' · failed' : ''}
              {x.ats_report ? ` · ${x.ats_report.coverage.pct}% match` : ''} · {timeAgo(x.created_at)}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <input placeholder="Optional: what to emphasise (e.g. backend, Java)" value={hint} onChange={(e) => setHint(e.target.value)} style={{ width: 'min(320px, 100%)' }} />
        <GatedButton gate={d.gates.generate} busy={busy === 'generate'} onClick={generate} className="btn">
          ✨ Generate tailored
        </GatedButton>
      </div>

      {d.reuse.length > 0 && (
        <div className="small muted" style={{ marginBottom: 10 }}>
          Similar job you applied to:{' '}
          {d.reuse.map((r) => (
            <button key={r.id} className="link-btn" style={{ marginRight: 10 }} onClick={() => reuse(r.id)}>
              {r.job_title} @ {r.company_name} ({Math.round(r.similarity * 100)}%)
            </button>
          ))}
        </div>
      )}

      {generating && (
        <div className="ok-box" style={{ marginBottom: 12 }}>
          <span className="spin" /> Claude is tailoring your resume to this job, then it’s checked, compiled and fitted to your page limit…
        </div>
      )}
      {v?.status === 'failed' && <div className="err-box" style={{ marginBottom: 12 }}>{v.error}</div>}
      {manual && v?.status === 'awaiting_manual' && (
        <div className="card manual-box" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 15 }}>Manual AI step</h3>
          <p className="muted small" style={{ margin: '6px 0 10px' }}>
            {manual.reason || 'Manual mode.'} Copy the prompt into claude.ai, then paste Claude’s JSON answer below. It’s checked by the same guards.
          </p>
          <div className="row-actions" style={{ marginTop: 0 }}>
            <button className="btn sm" onClick={() => navigator.clipboard.writeText(manual.prompt).then(() => toast('Prompt copied', 'success'))}>
              Copy prompt
            </button>
            <a className="btn sm" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open claude.ai ↗</a>
          </div>
          <textarea placeholder='Paste the JSON answer here ({"summary": …})' value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ marginTop: 10 }} />
          <div className="row-actions">
            <button className="btn primary sm" disabled={!answer.trim() || busy === 'manual'} onClick={sendManual}>
              Use this answer
            </button>
          </div>
        </div>
      )}

      <div className="studio-tabs seg multi">
        {(['edit', 'pdf', 'report'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'edit' ? 'LaTeX' : t === 'pdf' ? 'Preview' : 'Report'}
          </button>
        ))}
      </div>

      <div className="studio">
        <div className="pane" style={{ display: tab === 'edit' ? 'block' : 'none' }}>
          {v ? (
            <LatexEditor value={draft} onChange={setDraft} onSave={saveAndCompile} errorLines={errLines} jumpTo={jump} readOnly={generating} />
          ) : (
            <div className="cm-host skeleton" />
          )}
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn primary sm" disabled={!v || generating || busy === 'compile'} onClick={saveAndCompile}>
              {busy === 'compile' ? <span className="spin" /> : null} {dirty ? 'Save & compile' : 'Compile'} <span className="muted">(Ctrl+S)</span>
            </button>
            {dirty && <button className="btn sm" onClick={() => setDraft(v!.latex)}>Revert</button>}
            {v && v.generated_by !== 'user' && dirty && <span className="small muted">Saving creates a new version; this one stays as it was.</span>}
          </div>
        </div>

        <div className="pane" style={{ display: tab === 'pdf' ? 'block' : 'none' }}>
          <PdfView src={v?.compile_log?.ok ? `/api/resume/versions/${v.id}/pdf` : null} stamp={`${v?.id}:${v?.page_count}:${metaStamp}`} />
        </div>

        <div className="pane" style={{ display: tab === 'report' ? 'block' : 'none' }}>
          <div className="card" style={{ padding: 16 }}>
            {rep ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span className="big-num">{rep.coverage.pct}%</span>
                  <span className="muted small">
                    keyword match{rep.coverage.base_pct !== null ? ` (base ${rep.coverage.base_pct}%)` : ''} · {rep.pages} page{rep.pages > 1 ? 's' : ''}
                  </span>
                </div>
                {rep.coverage.required_missing.length > 0 && (
                  <div className="small" style={{ marginTop: 8 }}>
                    <span className="muted">Required, not on resume: </span>
                    {rep.coverage.required_missing.join(', ')}
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                      If you genuinely have one, add it in Settings → Resume → Skills inventory, then regenerate.
                    </div>
                  </div>
                )}
                <div className="checks" style={{ marginTop: 12 }}>
                  {rep.checks.map((c) => (
                    <div key={c.id} className={`check ${c.status}`}>
                      <span className="ic">{c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'}</span>
                      <span>
                        {c.label} <span className="det">— {c.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : v?.compile_log && !v.compile_log.ok ? (
              <>
                <h4 style={{ fontSize: 14 }}>Compile errors</h4>
                {v.compile_log.errors.map((e, i) => (
                  <div key={i} className="flag reject">
                    {e.line ? (
                      <button className="link-btn" onClick={() => { setTab('edit'); setJump({ line: e.line!, n: Date.now() }) }}>
                        Line {e.line}
                      </button>
                    ) : null}{' '}
                    {e.message}
                  </div>
                ))}
              </>
            ) : (
              <p className="muted small">Compile to see the ATS report.</p>
            )}

            {guard && (guard.flags.length > 0 || guard.notes.length > 0) && (
              <div className="section">
                <h3>AI changes checked</h3>
                {guard.flags.map((f, i) => (
                  <div key={i} className={`flag ${f.level}`}>
                    <b>{f.where}</b> — {f.message}
                  </div>
                ))}
                {guard.notes.map((n, i) => (
                  <div key={`n${i}`} className="flag">💡 {n}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            {locked?.id === v?.id ? (
              <div className="ok-box">🔒 This version is locked to the application.</div>
            ) : (
              <GatedButton gate={lockGate} busy={busy === 'lock'} onClick={lock}>
                Use this resume →
              </GatedButton>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
