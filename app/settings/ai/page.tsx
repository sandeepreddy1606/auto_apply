'use client'

import { useEffect, useState } from 'react'

import PageHeader from '@/components/PageHeader'
import { Input, LoadError, SaveBar, useGuardedBack, useSection } from '@/components/settings/shared'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { AiConfig } from '@/lib/types'

type Status = Awaited<ReturnType<typeof career.llmStatus>>

export default function AiPage() {
  const s = useSection<AiConfig & Record<string, unknown>>('ai', null)
  const back = useGuardedBack()
  const toast = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    career.llmStatus().then(setStatus).catch(() => {})
  }, [])

  const test = async () => {
    setTesting(true)
    try {
      const r = await career.llmTest()
      setStatus((cur) => ({ ...(cur as Status), ...r, last_test: { ok: r.ok, detail: r.detail, at: new Date().toISOString() } }))
      toast(r.ok ? 'Claude Code is signed in and answering.' : r.detail, r.ok ? 'success' : 'error')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  if (s.loadError) return (<><PageHeader title="AI" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>)
  if (!s.data) return (<><PageHeader title="AI" backTo="/settings" /><p className="muted">Loading…</p></>)
  const ai = s.data

  return (
    <>
      <PageHeader title="AI" sub="Used to tailor resumes and draft answers to open questions" onBack={back} />
      <div className="settings-stack">
        <div className="card">
          <h3>Provider</h3>
          <div className="stack" style={{ gap: 10 }}>
            <label className="toggle">
              <input type="radio" name="prov" checked={ai.provider === 'claude-code'} onChange={() => s.set('provider')('claude-code')} />
              <span><b>Claude Code (your Pro plan)</b> — runs the local <span className="mono">claude</span> CLI with tools disabled. No API bill.</span>
            </label>
            <label className="toggle">
              <input type="radio" name="prov" checked={ai.provider === 'manual'} onChange={() => s.set('provider')('manual')} />
              <span><b>Manual</b> — the app shows the prompt; you paste Claude’s answer from claude.ai.</span>
            </label>
          </div>
          {status && (
            <div className={status.last_test?.ok ? 'ok-box' : 'warn-box'} style={{ marginTop: 14 }}>
              {status.last_test ? status.last_test.detail : status.detail}
              <div className="small muted" style={{ marginTop: 4 }}>
                {status.version ? `${status.version} · ` : ''}AI calls today: {status.calls_today}/{ai.daily_cap}
              </div>
            </div>
          )}
          <div className="row-actions">
            <button className="btn primary sm" disabled={testing || ai.provider === 'manual'} onClick={test}>{testing ? <span className="spin" /> : null} Test sign-in</button>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            Not signed in? Open a terminal, run <span className="mono">claude</span>, type <span className="mono">/login</span> and choose your Pro account. Your login token is never read or stored by this app.
          </p>
        </div>

        <div className="card">
          <h3>Options</h3>
          <div className="stack">
            <Input label="Model (blank = your Claude Code default; e.g. sonnet, opus)" value={ai.model} onChange={s.set('model')} placeholder="default" />
            <Input label="Timeout per call (seconds)" value={ai.timeout_s} onChange={(v) => s.set('timeout_s')(v)} />
            <Input label="Daily call cap (protects your Pro limits)" value={ai.daily_cap} onChange={(v) => s.set('daily_cap')(v)} />
            <Input label="Path to claude (only if it isn't found automatically)" value={ai.claude_path} onChange={s.set('claude_path')} placeholder="C:\Users\you\.local\bin\claude.exe" />
            <label className="toggle">
              <input type="checkbox" checked={ai.fallback_manual} onChange={(e) => s.set('fallback_manual')(e.target.checked)} />
              <span>If Claude Code is unavailable or hits a limit, switch to Manual instead of failing</span>
            </label>
          </div>
        </div>
        <button className="btn primary" style={{ padding: 15 }} disabled={s.saving || !s.dirty} onClick={s.save}>{s.saving ? 'Saving…' : s.dirty ? 'Save AI settings' : 'All changes saved'}</button>
      </div>
      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount} onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
