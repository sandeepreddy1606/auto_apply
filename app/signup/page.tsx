'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useAuth } from '@/components/AuthProvider'
import {
  AuthHeading,
  AuthLayout,
  AuthSwitch,
  Banner,
  Field,
  Link,
  PasswordInput,
  RecoveryCodeStep,
  StrengthMeter,
  SubmitButton,
} from '@/components/auth/AuthUI'
import { api } from '@/lib/api'
import type { SignedIn } from '@/lib/api'

type Errs = Partial<Record<'name' | 'email' | 'password' | 'current' | 'newPassword', string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function SignupPage() {
  const { status, signedIn, nextPath } = useAuth()
  const router = useRouter()
  const upgrade = status?.state === 'upgrade'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [current, setCurrent] = useState('')
  const [changePw, setChangePw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errs, setErrs] = useState<Errs>({})
  const [done, setDone] = useState<SignedIn | null>(null)

  /** Editing a field clears its error (and the banner). */
  const edit = (key: keyof Errs, set: (v: string) => void) => (v: string) => {
    set(v)
    setErrs((e) => (e[key] ? { ...e, [key]: undefined } : e))
    setError(null)
  }

  // Already signed in and not showing the recovery code → into the app.
  useEffect(() => {
    if (status?.state === 'ready' && !done) router.replace('/')
  }, [status, done, router])

  const validate = (): Errs => {
    const e: Errs = {}
    if (!name.trim()) e.name = 'Tell us your name.'
    if (!email.trim()) e.email = 'Enter your email.'
    else if (!EMAIL_RE.test(email.trim())) e.email = 'That doesn’t look like an email address.'
    if (upgrade) {
      if (!current) e.current = 'Enter the password you use today.'
      if (changePw && password.length < 8) e.newPassword = 'Use at least 8 characters.'
    } else if (password.length < 8) e.password = 'Use at least 8 characters.'
    return e
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const e = validate()
    setErrs(e)
    setError(null)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const res = upgrade
        ? await api.upgrade({
            name: name.trim(),
            email: email.trim(),
            current_password: current,
            new_password: changePw ? password : undefined,
          })
        : await api.signup({ name: name.trim(), email: email.trim(), password })
      setDone(res)
      signedIn(res)
    } catch (err) {
      const msg = (err as Error).message
      // Route server messages to the field they're about.
      if (/password/i.test(msg) && !/current|dashboard/i.test(msg)) setErrs(upgrade ? { newPassword: msg } : { password: msg })
      else if (/current|dashboard password/i.test(msg)) setErrs({ current: msg })
      else if (/email/i.test(msg)) setErrs({ email: msg })
      else if (/name/i.test(msg)) setErrs({ name: msg })
      else setError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (done?.recovery_code) {
    return (
      <AuthLayout>
        <RecoveryCodeStep code={done.recovery_code} email={done.user.email} onDone={() => router.replace(nextPath())} />
      </AuthLayout>
    )
  }

  if (status?.state === 'login') {
    return (
      <AuthLayout>
        <div className="auth-form">
          <AuthHeading title="You already have an account" sub="This app keeps one person’s profile, so sign-up is closed once the account exists." />
          <Link className="btn primary auth-submit" href="/login">Go to sign in</Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit} noValidate>
        {upgrade ? (
          <>
            <AuthHeading
              title="Upgrade your sign-in"
              sub="Auto Apply now uses an email and password, with a way to recover your account. Your jobs, resumes and settings stay exactly as they are."
            />
            <Banner kind="info">Enter the dashboard password you use today, then add your name and email.</Banner>
          </>
        ) : (
          <AuthHeading title="Create your account" sub="Takes 30 seconds. Everything stays on this computer." />
        )}
        {error && <Banner kind="error">{error}</Banner>}

        <Field label="Your name" error={errs.name}>
          {(id) => (
            <input id={id} autoComplete="name" autoFocus placeholder="First and last name" value={name} onChange={(e) => edit('name', setName)(e.target.value)} />
          )}
        </Field>
        <Field label="Email" error={errs.email} hint="You’ll sign in with this.">
          {(id) => (
            <input
              id={id}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => edit('email', setEmail)(e.target.value)}
            />
          )}
        </Field>

        {upgrade ? (
          <>
            <Field label="Current dashboard password" error={errs.current}>
              {(id) => <PasswordInput id={id} value={current} onChange={edit('current', setCurrent)} autoComplete="current-password" />}
            </Field>
            <label className="auth-check">
              <input type="checkbox" checked={changePw} onChange={(e) => setChangePw(e.target.checked)} />
              <span>Choose a new password too</span>
            </label>
            {changePw && (
              <Field label="New password" error={errs.newPassword}>
                {(id) => (
                  <>
                    <PasswordInput id={id} value={password} onChange={edit('newPassword', setPassword)} autoComplete="new-password" />
                    {!errs.newPassword && <StrengthMeter password={password} />}
                  </>
                )}
              </Field>
            )}
          </>
        ) : (
          <Field label="Password" error={errs.password}>
            {(id) => (
              <>
                <PasswordInput id={id} value={password} onChange={edit('password', setPassword)} autoComplete="new-password" />
                {!errs.password && <StrengthMeter password={password} />}
              </>
            )}
          </Field>
        )}

        <SubmitButton busy={busy}>
          {busy ? (upgrade ? 'Upgrading…' : 'Creating account…') : upgrade ? 'Upgrade & continue' : 'Create account'}
        </SubmitButton>
        {!upgrade && <AuthSwitch>Next, you’ll get a recovery code in case you ever forget your password.</AuthSwitch>}
      </form>
    </AuthLayout>
  )
}
