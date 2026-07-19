import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, auth as tokenStore } from './api'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  // phase: 'loading' | 'setup' | 'login' | 'ready'
  const [phase, setPhase] = useState('loading')

  const check = useCallback(async () => {
    try {
      const s = await api.authStatus()
      if (!s.password_set) setPhase('setup')
      else if (s.authenticated) setPhase('ready')
      else setPhase('login')
    } catch {
      // Backend unreachable — retry shortly rather than locking the user out.
      setPhase('loading')
      setTimeout(check, 2000)
    }
  }, [])

  useEffect(() => { check() }, [check])

  useEffect(() => {
    const onUnauth = () => setPhase('login')
    window.addEventListener('aa-unauthorized', onUnauth)
    return () => window.removeEventListener('aa-unauthorized', onUnauth)
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setPhase('login')
  }, [])

  if (phase === 'loading') {
    return <div className="auth-screen"><p className="muted">Connecting…</p></div>
  }
  if (phase === 'setup') return <AuthForm mode="setup" onDone={() => setPhase('ready')} />
  if (phase === 'login') return <AuthForm mode="login" onDone={() => setPhase('ready')} />

  return <AuthContext.Provider value={{ logout }}>{children}</AuthContext.Provider>
}

function AuthForm({ mode, onDone }) {
  const setup = mode === 'setup'
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (setup) {
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
      if (password !== confirm) { setError('Passwords don’t match.'); return }
    } else if (!password) {
      setError('Enter your password.'); return
    }
    setBusy(true)
    try {
      const { token } = setup ? await api.authSetup(password) : await api.authLogin(password)
      tokenStore.set(token)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">⚡</div>
        <h1>Auto Apply</h1>
        <p className="muted">
          {setup
            ? 'Create a password to protect your dashboard. You’ll enter it to sign in from now on.'
            : 'Enter your password to unlock the dashboard.'}
        </p>
        <input
          type="password"
          autoFocus
          placeholder={setup ? 'Choose a password' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {setup && (
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary" style={{ padding: 14 }} disabled={busy} type="submit">
          {busy ? 'Please wait…' : setup ? 'Create password & continue' : 'Sign in'}
        </button>
        {setup && (
          <p className="muted" style={{ fontSize: 11.5 }}>
            No account or email needed — this is a single password stored only on this machine.
            If you forget it, delete <code>data/auth.json</code> to reset.
          </p>
        )}
      </form>
    </div>
  )
}
