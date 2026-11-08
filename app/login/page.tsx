'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { useAuth } from '@/components/AuthProvider'
import {
  AuthHeading,
  AuthLayout,
  AuthSwitch,
  Banner,
  Field,
  Link,
  PasswordInput,
  SubmitButton,
} from '@/components/auth/AuthUI'
import { api } from '@/lib/api'

export default function LoginPage() {
  const { signedIn, nextPath, refresh } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({})

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const fe: typeof fieldErr = {}
    if (!email.trim()) fe.email = 'Enter your email.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = 'That doesn’t look like an email address.'
    if (!password) fe.password = 'Enter your password.'
    setFieldErr(fe)
    setError(null)
    if (fe.email || fe.password) return
    setBusy(true)
    try {
      const res = await api.login(email.trim(), password, remember)
      signedIn(res)
      router.replace(nextPath())
    } catch (err) {
      const msg = (err as Error).message
      if (/no account yet/i.test(msg)) {
        await refresh()
        return
      }
      setError(msg)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthHeading title="Welcome back" sub="Sign in to continue to your dashboard." />
        {error && <Banner kind="error">{error}</Banner>}
        <Field label="Email" error={fieldErr.email}>
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
              onChange={(e) => {
                setEmail(e.target.value)
                setFieldErr((f) => ({ ...f, email: undefined }))
              }}
            />
          )}
        </Field>
        <Field
          label="Password"
          error={fieldErr.password}
          aside={
            <Link className="auth-link" href={`/forgot${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`}>
              Forgot password?
            </Link>
          }
        >
          {(id) => <PasswordInput
              id={id}
              value={password}
              onChange={(v) => {
                setPassword(v)
                setFieldErr((f) => ({ ...f, password: undefined }))
              }}
              autoComplete="current-password"
            />}
        </Field>
        <label className="auth-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Keep me signed in for 30 days</span>
        </label>
        <SubmitButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</SubmitButton>
        <AuthSwitch>On a shared computer? Untick “keep me signed in” and you’ll be signed out when the browser closes.</AuthSwitch>
      </form>
    </AuthLayout>
  )
}
