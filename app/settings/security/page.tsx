'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/components/AuthProvider'
import { PasswordInput, RecoveryCodeStep, StrengthMeter } from '@/components/auth/AuthUI'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { AuthSession } from '@/lib/api'

/** "Chrome on Windows", "Safari on iPhone", … from a user-agent string. */
function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device'
  if (/node|undici|curl|python|postman/i.test(ua) && !/mozilla/i.test(ua)) return 'Script / API client'
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\/|opera/i.test(ua)
      ? 'Opera'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /chrome|crios|chromium/i.test(ua)
          ? 'Chrome'
          : /safari/i.test(ua)
            ? 'Safari'
            : 'Browser'
  const os = /iphone/i.test(ua)
    ? 'iPhone'
    : /ipad/i.test(ua)
      ? 'iPad'
      : /android/i.test(ua)
        ? 'Android'
        : /windows/i.test(ua)
          ? 'Windows'
          : /mac os x|macintosh/i.test(ua)
            ? 'Mac'
            : /linux/i.test(ua)
              ? 'Linux'
              : ''
  return os ? `${browser} on ${os}` : browser
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export default function SecurityPage() {
  const { user, setUser, logout } = useAuth()
  const toast = useToast()

  // profile
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [profilePw, setProfilePw] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const emailChanged = email.trim().toLowerCase() !== (user?.email ?? '')
  const profileDirty = name.trim() !== (user?.name ?? '') || emailChanged

  // password
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [changing, setChanging] = useState(false)

  // recovery
  const [recPw, setRecPw] = useState('')
  const [newCode, setNewCode] = useState<string | null>(null)
  const [recBusy, setRecBusy] = useState(false)

  // devices
  const [sessions, setSessions] = useState<AuthSession[] | null>(null)

  const loadSessions = useCallback(async () => {
    try {
      setSessions((await api.sessions()).sessions)
    } catch {
      setSessions([])
    }
  }, [])
  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      const { user: u } = await api.updateMe({ name, email, password: emailChanged ? profilePw : undefined })
      setUser(u)
      setName(u.name)
      setEmail(u.email)
      setProfilePw('')
      toast('Account details saved.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  const change = async () => {
    if (next.length < 8) {
      toast('Your new password needs at least 8 characters.', 'error')
      return
    }
    setChanging(true)
    try {
      await api.authChange(current, next)
      setCurrent('')
      setNext('')
      toast('Password changed. Other devices were signed out.', 'success')
      void loadSessions()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setChanging(false)
    }
  }

  const regenerate = async () => {
    setRecBusy(true)
    try {
      setNewCode((await api.newRecoveryCode(recPw)).recovery_code)
      setRecPw('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setRecBusy(false)
    }
  }

  const revoke = async (s: AuthSession) => {
    try {
      await api.revokeSession(s.id)
      toast(`Signed out ${deviceName(s.user_agent)}.`, 'success')
      void loadSessions()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const revokeOthers = async () => {
    try {
      const { revoked } = await api.revokeOtherSessions()
      toast(revoked ? `Signed out ${revoked} other device${revoked === 1 ? '' : 's'}.` : 'No other devices were signed in.', 'success')
      void loadSessions()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current).length

  return (
    <>
      <PageHeader title="Account & security" sub={user ? `Signed in as ${user.email}` : undefined} backTo="/settings" />

      <div className="settings-stack">
        <div className="card">
          <h3>Your account</h3>
          <div className="stack">
            <label className="field">
              <span className="lbl">Name</span>
              <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="lbl">Email (used to sign in)</span>
              <input type="email" value={email} autoComplete="email" autoCapitalize="off" onChange={(e) => setEmail(e.target.value)} />
            </label>
            {emailChanged && (
              <label className="field">
                <span className="lbl">Confirm with your password</span>
                <PasswordInput id="profile-pw" value={profilePw} onChange={setProfilePw} autoComplete="current-password" />
              </label>
            )}
            <div>
              <button className="btn sm primary" disabled={!profileDirty || savingProfile || (emailChanged && !profilePw)} onClick={saveProfile}>
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              This is your sign-in identity. The details used in applications live in Settings → Profile.
            </p>
          </div>
        </div>

        <div className="card">
          <h3>Change password</h3>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              void change()
            }}
          >
            <input type="email" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
            <label className="field">
              <span className="lbl">Current password</span>
              <PasswordInput id="cur-pw" value={current} onChange={setCurrent} autoComplete="current-password" />
            </label>
            <label className="field">
              <span className="lbl">New password</span>
              <PasswordInput id="new-pw" value={next} onChange={setNext} autoComplete="new-password" />
              <StrengthMeter password={next} />
            </label>
            <div>
              <button className="btn sm primary" type="submit" disabled={changing || !current || !next}>
                {changing ? 'Changing…' : 'Change password'}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              You stay signed in here; every other device is signed out.
            </p>
          </form>
        </div>

        <div className="card">
          <h3>Recovery code</h3>
          {newCode ? (
            <RecoveryCodeStep
              code={newCode}
              email={user?.email ?? ''}
              onDone={() => {
                setNewCode(null)
                toast('New recovery code saved. The old one no longer works.', 'success')
              }}
            />
          ) : (
            <div className="stack">
              <p className="muted" style={{ fontSize: 13 }}>
                Lets you reset your password from the sign-in page if you forget it. Lost it, or think someone saw
                it? Make a new one — the old code stops working.
              </p>
              <label className="field">
                <span className="lbl">Your password</span>
                <PasswordInput id="rec-pw" value={recPw} onChange={setRecPw} autoComplete="current-password" />
              </label>
              <div>
                <button className="btn sm" disabled={!recPw || recBusy} onClick={regenerate}>
                  {recBusy ? 'Generating…' : 'Generate a new recovery code'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="row-between">
            <h3>Where you’re signed in</h3>
            {others > 0 && (
              <button className="btn sm danger" onClick={revokeOthers}>
                Sign out all others
              </button>
            )}
          </div>
          {sessions === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <ul className="device-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <div>
                    <b>
                      {deviceName(s.user_agent)}
                      {s.current && <span className="pill-now">This device</span>}
                    </b>
                    <small className="muted">
                      {s.current ? 'Active now' : `Last active ${ago(s.last_seen_at)}`}
                      {s.ip ? ` · ${s.ip}` : ''} · {s.remember ? 'stays signed in' : 'until browser closes'}
                    </small>
                  </div>
                  {!s.current && (
                    <button className="btn sm" onClick={() => revoke(s)}>
                      Sign out
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Telegram listening and background scans keep running while you’re signed out.
          </p>
        </div>

        <div className="card">
          <h3>Sign out</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Sign out of Auto Apply on this device.</p>
          <button className="btn danger" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    </>
  )
}
