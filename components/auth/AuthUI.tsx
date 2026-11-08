'use client'

/** Building blocks for the sign-in pages: layout, fields, password strength, recovery code. */
import Link from 'next/link'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-hero" aria-hidden="false">
        <div className="auth-hero-inner">
          <div className="auth-brand">
            <span className="auth-mark">⚡</span>
            <span>Auto Apply</span>
          </div>
          <h2>Your job search, on autopilot — with you in control.</h2>
          <ul className="auth-points">
            <li><b>Every job in one place.</b> Career pages and Telegram posts, ranked for your profile.</li>
            <li><b>A tailored resume per job.</b> ATS-friendly LaTeX you can edit before it’s sent.</li>
            <li><b>Autofill you can review.</b> Nothing is submitted until you approve it.</li>
          </ul>
          <p className="auth-foot">Your data stays on this computer.</p>
        </div>
      </section>
      <main className="auth-main">
        <div className="auth-brand auth-brand-mobile">
          <span className="auth-mark">⚡</span>
          <span>Auto Apply</span>
        </div>
        <div className="auth-panel">{children}</div>
      </main>
    </div>
  )
}

export function AuthHeading({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="auth-heading">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </header>
  )
}

export function Field({
  label,
  error,
  hint,
  aside,
  children,
}: {
  label: string
  error?: string | null
  hint?: ReactNode
  aside?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={error ? 'af invalid' : 'af'}>
      <div className="af-top">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      {children(id)}
      {error ? (
        <p className="af-err" role="alert">{error}</p>
      ) : hint ? (
        <p className="af-hint">{hint}</p>
      ) : null}
    </div>
  )
}

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
  autoFocus?: boolean
}) {
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  return (
    <>
      <div className="pw-wrap">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          onClick={() => setShow((s) => !s)}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {caps && <p className="af-warn">Caps Lock is on</p>}
    </>
  )
}

/** Rough strength estimate for the meter (the server enforces the real rules). */
export function passwordScore(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: '' }
  let variety = 0
  if (/[a-z]/.test(pw)) variety++
  if (/[A-Z]/.test(pw)) variety++
  if (/\d/.test(pw)) variety++
  if (/[^A-Za-z0-9]/.test(pw)) variety++
  const unique = new Set(pw).size
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (variety >= 3 || (pw.length >= 16 && variety >= 2)) score++
  if (pw.length >= 14 && variety >= 3 && unique >= 8) score++
  if (pw.length < 8 || unique < 4) score = Math.min(score, 1)
  const s = Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4
  return { score: s, label: ['', 'Too weak', 'Okay', 'Good', 'Strong'][s] }
}

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordScore(password)
  if (!password) return <p className="af-hint">At least 8 characters. A short phrase is easy to remember and hard to guess.</p>
  return (
    <div className={`pw-meter s${score}`} aria-live="polite">
      <div className="pw-bars">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= score ? 'on' : ''} />
        ))}
      </div>
      <span>{password.length < 8 ? `${8 - password.length} more character${password.length === 7 ? '' : 's'}` : label}</span>
    </div>
  )
}

export function Banner({ kind, children }: { kind: 'error' | 'info' | 'success'; children: ReactNode }) {
  return (
    <div className={`auth-banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function SubmitButton({ busy, children, disabled }: { busy: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button className="btn primary auth-submit" type="submit" disabled={busy || disabled} aria-busy={busy}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  )
}

export function AuthSwitch({ children }: { children: ReactNode }) {
  return <p className="auth-switch">{children}</p>
}

export { Link }

/** Shown once after sign-up / recovery-code reset. */
export function RecoveryCodeStep({ code, email, onDone }: { code: string; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the code is selectable */
    }
  }
  const download = () => {
    const text = `Auto Apply recovery code\n\nAccount: ${email}\nCode: ${code}\n\nUse this on the "Forgot password?" page if you lose your password.\nIt works once; you'll get a new one after using it.\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'auto-apply-recovery-code.txt'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setSaved(true)
  }
  return (
    <div className="auth-form">
      <AuthHeading
        title="Save your recovery code"
        sub="If you ever forget your password, this code lets you set a new one. It’s shown only once."
      />
      <div className="recovery-code" aria-label="Recovery code">
        {code}
      </div>
      <div className="recovery-actions">
        <button type="button" className="btn" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="btn" onClick={download}>
          Download .txt
        </button>
      </div>
      <label className="auth-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I’ve saved it somewhere safe (a password manager is ideal)</span>
      </label>
      <button type="button" className="btn primary auth-submit" disabled={!saved} onClick={onDone}>
        Continue to Auto Apply
      </button>
    </div>
  )
}
