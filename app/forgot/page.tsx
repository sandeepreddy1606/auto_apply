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

type Method = 'email' | 'recovery'
type Step = 'start' | 'reset'

export default function ForgotPage() {
  const { status, signedIn, nextPath } = useAuth()
  const router = useRouter()
  const emailAvailable = Boolean(status?.email_reset)
  const [method, setMethod] = useState<Method>('recovery')
  const [step, setStep] = useState<Step>('start')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [done, setDone] = useState<SignedIn | null>(null)

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('email')
    if (e) setEmail(e)
  }, [])
  useEffect(() => {
    setMethod(emailAvailable ? 'email' : 'recovery')
  }, [emailAvailable])
  useEffect(() => {
    if (status?.state === 'ready' && !done) router.replace('/')
  }, [status, done, router])

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!validEmail) {
      setError('Enter the email you signed up with.')
      return
    }
    if (method === 'recovery') {
      setStep('reset')
      return
    }
    setBusy(true)
    try {
      await api.forgot(email.trim())
      setInfo(`If ${email.trim()} has an account, a 6-digit code is on its way. It expires in 15 minutes.`)
      setStep('reset')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!code.trim()) {
      setError(method === 'email' ? 'Enter the 6-digit code from the email.' : 'Enter your recovery code.')
      return
    }
    if (password.length < 8) {
      setError('Your new password needs at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      const res = await api.reset({
        email: email.trim(),
        password,
        ...(method === 'email' ? { code: code.trim() } : { recovery_code: code.trim() }),
      })
      setDone(res)
      signedIn(res)
      if (!res.recovery_code) router.replace(nextPath())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done?.recovery_code) {
    return (
      <AuthLayout>
        <Banner kind="success">Password changed. You’re signed in, and every other device was signed out.</Banner>
        <RecoveryCodeStep code={done.recovery_code} email={done.user.email} onDone={() => router.replace(nextPath())} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      {step === 'start' ? (
        <form className="auth-form" onSubmit={start} noValidate>
          <AuthHeading title="Reset your password" sub="No problem — it happens. Choose how to verify it’s you." />
          {error && <Banner kind="error">{error}</Banner>}
          <Field label="Email">
            {(id) => (
              <input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <div className="auth-choices" role="radiogroup" aria-label="Verification method">
            <button
              type="button"
              role="radio"
              aria-checked={method === 'email'}
              className={method === 'email' ? 'auth-choice on' : 'auth-choice'}
              disabled={!emailAvailable}
              onClick={() => setMethod('email')}
            >
              <b>Email me a code</b>
              <span>{emailAvailable ? 'Sent with your SMTP settings.' : 'Needs email (SMTP) set up in Settings.'}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={method === 'recovery'}
              className={method === 'recovery' ? 'auth-choice on' : 'auth-choice'}
              onClick={() => setMethod('recovery')}
            >
              <b>Use my recovery code</b>
              <span>The code you saved when you created your account.</span>
            </button>
          </div>
          <SubmitButton busy={busy}>{busy ? 'Sending…' : 'Continue'}</SubmitButton>
          <AuthSwitch>
            Remembered it? <Link className="auth-link" href="/login">Back to sign in</Link>
          </AuthSwitch>
          <details className="auth-help">
            <summary>Lost your recovery code too?</summary>
            <p>
              On the computer running Auto Apply, open a terminal in the app folder and run{' '}
              <code>npm run auth:recover</code>. It prints a fresh recovery code for your account.
            </p>
          </details>
        </form>
      ) : (
        <form className="auth-form" onSubmit={reset} noValidate>
          <AuthHeading
            title={method === 'email' ? 'Check your email' : 'Enter your recovery code'}
            sub={<>Resetting the password for <b>{email.trim()}</b>.</>}
          />
          {info && <Banner kind="info">{info}</Banner>}
          {error && <Banner kind="error">{error}</Banner>}
          <Field
            label={method === 'email' ? '6-digit code' : 'Recovery code'}
            hint={method === 'recovery' ? 'Looks like ABCD-EFGH-JKLM-NPQR. Dashes and capitals don’t matter.' : undefined}
          >
            {(id) => (
              <input
                id={id}
                className="code-input"
                autoFocus
                autoComplete="one-time-code"
                inputMode={method === 'email' ? 'numeric' : 'text'}
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={method === 'email' ? 6 : 24}
                placeholder={method === 'email' ? '123456' : 'XXXX-XXXX-XXXX-XXXX'}
                value={code}
                onChange={(e) => setCode(method === 'email' ? e.target.value.replace(/\D/g, '') : e.target.value)}
              />
            )}
          </Field>
          <Field label="New password">
            {(id) => (
              <>
                <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" />
                <StrengthMeter password={password} />
              </>
            )}
          </Field>
          <SubmitButton busy={busy}>{busy ? 'Saving…' : 'Set new password & sign in'}</SubmitButton>
          <AuthSwitch>
            <button
              type="button"
              className="auth-link as-button"
              onClick={() => {
                setStep('start')
                setCode('')
                setError(null)
                setInfo(null)
              }}
            >
              ← Use a different method
            </button>
          </AuthSwitch>
        </form>
      )}
    </AuthLayout>
  )
}
