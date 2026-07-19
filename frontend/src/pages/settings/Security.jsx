import { useState } from 'react'
import { api, auth as tokenStore } from '../../api'
import { useToast } from '../../Toast'
import { useAuth } from '../../auth'
import PageHeader from '../../components/PageHeader'
import { Input } from './shared'

export default function SecurityPage() {
  const { logout } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const change = async () => {
    if (next.length < 6) { toast('New password must be at least 6 characters.', 'error'); return }
    if (next !== confirm) { toast('New passwords don’t match.', 'error'); return }
    setBusy(true)
    try {
      const { token } = await api.authChange(current, next)
      tokenStore.set(token) // old token was invalidated server-side
      setCurrent(''); setNext(''); setConfirm('')
      toast('Password changed.', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Security" sub="Dashboard password & session" backTo="/settings" />

      <div className="settings-stack">
        <div className="card">
          <h3>Change password</h3>
          <div className="stack">
            <Input label="Current password" type="password" value={current} onChange={setCurrent} />
            <Input label="New password" type="password" value={next} onChange={setNext} />
            <Input label="Confirm new password" type="password" value={confirm} onChange={setConfirm} />
            <div>
              <button className="btn sm primary" disabled={busy || !current || !next} onClick={change}>
                {busy ? 'Changing…' : 'Change password'}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Changing your password signs you out everywhere else immediately.
            </p>
          </div>
        </div>

        <div className="card">
          <h3>Session</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            You’ll stay signed in on this device for 30 days. The Telegram listener and
            background scans keep running even while you’re signed out.
          </p>
          <button className="btn danger" onClick={logout}>Sign out</button>
        </div>
      </div>
    </>
  )
}
