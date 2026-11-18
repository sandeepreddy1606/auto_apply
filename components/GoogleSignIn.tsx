'use client'

/**
 * "Sign in to Google" for forms that need a Google account. Opens the
 * automation browser's profile as an ordinary window at Google's sign-in
 * page; you sign in there yourself and close the window. From then on those
 * forms open signed in when you press Apply.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { GoogleSignInStatus } from '@/lib/api'

export default function GoogleSignIn({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const toast = useToast()
  const [st, setSt] = useState<GoogleSignInStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const waiting = useRef(false)

  const refresh = useCallback(() => api.googleSignInState().then(setSt).catch(() => {}), [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  // While the window is open, watch for it to close — then report what really happened.
  const open_ = st?.state === 'open'
  useEffect(() => {
    if (!open_ && !busy) return
    const t = setInterval(() => {
      api.googleSignInState().then((s) => {
        setSt(s)
        if (s.state === 'open') {
          waiting.current = true
          return
        }
        if (!waiting.current) return // the task hasn't started yet
        waiting.current = false
        setBusy(false)
        if (s.state === 'signed_in' || s.signed_in) {
          toast('Signed in to Google. Forms that need an account will now be filled with it.', 'success')
          onDone?.()
        } else {
          toast(s.message || 'The window closed before you finished signing in.', 'error')
        }
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(t)
  }, [open_, busy, toast, onDone])

  const open = async () => {
    setBusy(true)
    waiting.current = false
    try {
      await api.googleSignIn()
      toast('A browser window is opening. Sign in to your Google account there, then close the window.', 'info')
    } catch (e) {
      setBusy(false)
      toast((e as Error).message, 'error')
    }
  }

  const working = open_ || busy
  const signed = st?.signed_in === true
  const problem = !working && st && ['not_signed_in', 'busy', 'failed', 'timed_out'].includes(st.state) && !signed ? st.message : null
  return (
    <div className={`gsign ${compact ? 'compact' : ''}`}>
      <button className={`btn ${signed ? '' : 'primary'} ${compact ? 'sm' : ''}`} disabled={working} onClick={open}>
        {working ? <span className="spin" /> : <GoogleMark />}
        {working ? 'Waiting for you to sign in…' : signed ? 'Sign in again' : 'Sign in to Google'}
      </button>
      {signed && !working && <span className="pill ok">Signed in</span>}
      {!compact && (
        <span className="muted small">
          {working
            ? 'Sign in in the window that opened, then close that window.'
            : signed
              ? `Your Google account is signed in in the automation browser${st?.browser === 'chrome' ? ' (Google Chrome)' : ''}. Use “Sign in again” to switch accounts.`
              : 'Needed for Google Forms that ask you to sign in or upload a file. You sign in yourself; the app never sees your password.'}
        </span>
      )}
      {problem && <span className="small" style={{ color: 'var(--red)', flexBasis: '100%' }}>{problem}</span>}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  )
}
