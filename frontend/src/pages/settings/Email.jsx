import { useState } from 'react'
import { api } from '../../api'
import { useToast } from '../../Toast'
import PageHeader from '../../components/PageHeader'
import { Input, useSection, useGuardedBack, SaveBar, LoadError, validateSmtp, EMAIL_RE } from './shared'

export default function EmailPage() {
  const s = useSection('smtp', validateSmtp)
  const back = useGuardedBack(s.dirty)
  const [testTo, setTestTo] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const toast = useToast()

  if (s.loadError) return <><PageHeader title="Email sending" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>
  if (!s.data) return <><PageHeader title="Email sending" backTo="/settings" /><p className="muted">Loading…</p></>

  const m = s.data
  const smtpReady = !!(m.host && m.username && m.password)

  const setConnection = (useSsl) => {
    s.setData((d) => {
      const port = String(d.port).trim()
      const next = { ...d, use_ssl: useSsl }
      // Keep the port in step unless the user picked a custom one.
      if (useSsl && (port === '587' || port === '')) next.port = 465
      if (!useSsl && (port === '465' || port === '')) next.port = 587
      return next
    })
  }

  const testEmail = async () => {
    const to = (testTo || s.full?.profile?.email || '').trim()
    if (!to) { toast('Enter a recipient (or fill your profile email).', 'error'); return }
    if (!EMAIL_RE.test(to)) { toast('Recipient doesn’t look like a valid email.', 'error'); return }
    setTestBusy(true)
    try {
      const saved = await api.saveSettings({ smtp: m })
      s.markSaved(saved.smtp)
      await api.testEmail(to)
      toast(`Test email sent to ${to} — check the inbox.`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Email sending" sub="SMTP account used to send applications" onBack={back} />

      <div className="settings-stack">
        <div className="card">
          <div className="grid-2">
            <Input label="SMTP host" value={m.host} onChange={s.set('host')} />
            <Input label="Port" value={m.port} onChange={s.set('port')} error={s.errors.port} />
            <Input label="From name" value={m.from_name} onChange={s.set('from_name')} />
            <Input label="Username (email)" value={m.username} onChange={s.set('username')} error={s.errors.username} />
            <Input label="Password / app password" type="password" value={m.password} onChange={s.set('password')} />
            <label className="field">
              <span className="lbl">Connection</span>
              <select value={m.use_ssl ? '1' : '0'} onChange={(e) => setConnection(e.target.value === '1')}>
                <option value="0">STARTTLS (port 587)</option>
                <option value="1">SSL (port 465)</option>
              </select>
            </label>
          </div>
          <p className="muted" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
            Gmail: enable 2-step verification, create an <strong>App password</strong>, use it here.
          </p>
        </div>

        <div className="card">
          <h3>Send a test email</h3>
          <div className="row-actions" style={{ marginTop: 0 }}>
            <input style={{ maxWidth: 250 }} placeholder="Send test to… (default: your email)"
              value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button className="btn sm" disabled={!smtpReady || testBusy}
              title={smtpReady ? '' : 'Fill host, username and password first'} onClick={testEmail}>
              {testBusy ? 'Sending…' : 'Send test'}
            </button>
          </div>
          {!smtpReady && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Fill host, username & password to test.</p>}
        </div>

        <button className="btn primary" style={{ padding: '15px', fontSize: 15 }}
          disabled={s.saving || !s.dirty} onClick={s.save}>
          {s.saving ? 'Saving…' : s.dirty ? 'Save email settings' : 'All changes saved'}
        </button>
      </div>

      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount}
        onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
