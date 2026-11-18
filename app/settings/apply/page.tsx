'use client'

import { useState } from 'react'

import { ChipInput } from '@/components/career/ui'
import GoogleSignIn from '@/components/GoogleSignIn'
import PageHeader from '@/components/PageHeader'
import { Input, LoadError, SaveBar, useGuardedBack, useSection } from '@/components/settings/shared'
import { useToast } from '@/components/Toast'
import { career } from '@/lib/career-api'
import type { ApplyAutomationConfig } from '@/lib/types'

export default function ApplyAutomationPage() {
  const s = useSection<ApplyAutomationConfig & Record<string, unknown>>('apply_automation', null)
  const back = useGuardedBack()
  const toast = useToast()
  const [url, setUrl] = useState('')
  if (s.loadError) return (<><PageHeader title="Apply automation" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>)
  if (!s.data) return (<><PageHeader title="Apply automation" backTo="/settings" /><p className="muted">Loading…</p></>)
  const a = s.data

  const open = async () => {
    try {
      await career.openBrowser(url.trim() || undefined)
      toast('Opening the automation browser on this computer…', 'info')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <>
      <PageHeader title="Apply automation" sub="How the browser fills and submits applications" onBack={back} />
      <div className="settings-stack">
        <div className="card">
          <h3>Google account for forms</h3>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Some Google Forms in job posts need you to be signed in (they collect your email or ask you to upload a
            resume). Sign in once here; those forms then open with your account when you press Apply.
          </p>
          <GoogleSignIn />
        </div>

        <div className="card">
          <h3>Browser</h3>
          <div className="stack" style={{ gap: 10 }}>
            <label className="toggle">
              <input type="radio" name="mode" checked={!a.headless} onChange={() => s.set('headless')(false)} />
              <span><b>Visible window (recommended on a laptop)</b> — watch it fill, type into it, solve CAPTCHAs yourself.</span>
            </label>
            <label className="toggle">
              <input type="radio" name="mode" checked={a.headless} onChange={() => s.set('headless')(true)} />
              <span><b>Headless (server)</b> — no window; you review screenshots. Sign-in and CAPTCHA pages will block.</span>
            </label>
          </div>
          <h3 style={{ marginTop: 16 }}>Which browser</h3>
          <div className="stack" style={{ gap: 10 }}>
            <label className="toggle">
              <input type="radio" name="browser" checked={a.browser !== 'chrome'} onChange={() => s.set('browser')('chromium')} />
              <span><b>Built-in Chromium (default)</b> — installed with the app.</span>
            </label>
            <label className="toggle">
              <input type="radio" name="browser" checked={a.browser === 'chrome'} onChange={() => s.set('browser')('chrome')} />
              <span><b>Your installed Google Chrome</b> — pick this if Google says “This browser or app may not be secure” when you sign in. It uses its own profile (not your everyday one), so sign in to Google again after switching.</span>
            </label>
          </div>
        </div>

        <div className="card">
          <h3>Sign in to ATS accounts once</h3>
          <p className="muted small" style={{ margin: '4px 0 10px' }}>
            Workday, iCIMS and similar sites need a candidate account per company. Open the automation browser, sign in, and it stays signed in for future applications. It’s a separate profile from your everyday browser.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input placeholder="Optional: https://company.wd1.myworkdayjobs.com/…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: '1 1 260px' }} />
            <button className="btn primary sm" onClick={open}>Open automation browser</button>
          </div>
        </div>

        <div className="card">
          <h3>Limits & timing</h3>
          <div className="stack">
            <Input label="Max submissions per day" value={a.daily_cap} onChange={(v) => s.set('daily_cap')(v)} />
            <Input label="Warn if I applied to the same company within (days)" value={a.duplicate_days} onChange={(v) => s.set('duplicate_days')(v)} />
            <Input label="Keep the form open for review (minutes)" value={a.session_timeout_min} onChange={(v) => s.set('session_timeout_min')(v)} />
            <Input label="Typing delay per character (ms)" value={a.typing_delay_ms} onChange={(v) => s.set('typing_delay_ms')(v)} />
            <Input label="Keep screenshots for (days)" value={a.screenshot_retention_days} onChange={(v) => s.set('screenshot_retention_days')(v)} />
          </div>
        </div>

        <div className="card">
          <h3>Extra allowed domains</h3>
          <p className="muted small" style={{ margin: '4px 0 10px' }}>
            The browser only navigates to the job’s site, known job boards and common sign-in pages. Add company SSO domains here if a sign-in redirect is blocked.
          </p>
          <ChipInput value={a.extra_domains} onChange={s.set('extra_domains')} placeholder="e.g. sso.company.com" />
        </div>

        <button className="btn primary" style={{ padding: 15 }} disabled={s.saving || !s.dirty} onClick={s.save}>{s.saving ? 'Saving…' : s.dirty ? 'Save automation settings' : 'All changes saved'}</button>
      </div>
      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount} onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
