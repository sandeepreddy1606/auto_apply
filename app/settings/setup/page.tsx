'use client'

import { useCallback, useEffect, useState } from 'react'

import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { SetupCheck } from '@/lib/types'

type Installs = Record<string, { running?: boolean; ok?: boolean; log?: string }>

export default function SetupPage() {
  const [checks, setChecks] = useState<SetupCheck[] | null>(null)
  const [installs, setInstalls] = useState<Installs>({})
  const [queue, setQueue] = useState<Record<string, number>>({})
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const navigate = useNavigate()
  const toast = useToast()

  const load = useCallback(() => {
    career
      .setup()
      .then((r) => {
        setChecks(r.checks)
        setInstalls(r.installs)
        setQueue(r.queue)
        setErr(null)
      })
      .catch((e) => setErr((e as Error).message))
  }, [])
  useEffect(load, [load])

  // Poll faster while an installer runs or the worker is down.
  const anyRunning = Object.values(installs).some((i) => i.running)
  const workerDown = checks?.find((c) => c.id === 'worker')?.status === 'fail'
  useEffect(() => {
    const t = setInterval(load, anyRunning || workerDown ? 2500 : 15000)
    return () => clearInterval(t)
  }, [load, anyRunning, workerDown])

  const fix = async (c: SetupCheck) => {
    if (!c.fix) return
    if (c.fix.kind === 'link') return navigate(c.fix.target)
    if (c.fix.kind === 'info') return toast(c.fix.target, 'info')
    setBusy(c.id)
    try {
      if (c.fix.kind === 'install') {
        if (!window.confirm(`Install ${c.label}? This runs a fixed installer on your machine and may take several minutes.`)) return
        await career.install(c.fix.target)
        toast('Installer started — the log appears below.', 'info')
      } else if (c.fix.target === 'restart_worker') {
        await career.restartWorker()
        toast('Worker restarting…', 'info')
      }
      setTimeout(load, 1500)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const failing = checks?.filter((c) => c.status === 'fail').length ?? 0

  return (
    <>
      <PageHeader title="Setup & health" sub="Everything the apply flow needs, checked live" backTo="/settings" />
      {err && <div className="err-box">{err}</div>}
      {checks && (
        <div className={failing ? 'warn-box' : 'ok-box'} style={{ marginBottom: 14 }}>
          {failing ? `${failing} item${failing > 1 ? 's' : ''} need attention. Work top to bottom.` : 'All set — you can tailor, fill and submit.'}
          {queue.queued ? ` · ${queue.queued} background task(s) queued` : ''}
        </div>
      )}
      <div className="card" style={{ padding: '6px 18px' }}>
        {!checks && <div className="skeleton" style={{ margin: '14px 0' }} />}
        {checks?.map((c) => {
          const inst = c.fix?.kind === 'install' ? installs[c.fix.target] : undefined
          return (
            <div key={c.id} className="setup-row">
              <span className={`sd ${c.status}`} />
              <div style={{ minWidth: 0 }}>
                <div className="sl">{c.label}</div>
                <div className="sdet">{c.detail}</div>
                {c.status !== 'ok' && c.blocks && <div className="sblk">Needed for: {c.blocks}</div>}
              </div>
              {c.fix && (c.status !== 'ok' || c.fix.kind === 'action') && (
                <button className={`btn sm ${c.status === 'fail' ? 'primary' : ''}`} disabled={busy === c.id || inst?.running} onClick={() => fix(c)}>
                  {inst?.running ? <span className="spin" /> : null} {c.fix.label}
                </button>
              )}
              {inst?.log && <pre className="install-log">{inst.log}</pre>}
            </div>
          )
        })}
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        Claude Code sign-in can&apos;t happen inside the app: open a terminal, run <span className="mono">claude</span>, type{' '}
        <span className="mono">/login</span> and pick your Pro account, then press Test in Settings → AI.
      </p>
    </>
  )
}
