'use client'

/**
 * "Fill with AI" for a post's Google Form: the AI answers the empty questions
 * from your profile, saved answers, resume and the job post — nothing is
 * sent. Answers appear marked "AI"; edit any of them, then Apply.
 *
 * Starts by itself once when a post has unanswered questions and the AI has
 * never looked at it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { AiFillState } from '@/lib/api'
import type { FormAnswers } from '@/lib/types'

export default function AiFillBar({
  appId,
  answers,
  missing,
  aiCount,
  disabled,
  onDone,
}: {
  appId: number
  /** The answers on the page now (your edits are saved as yours first). */
  answers: FormAnswers
  missing: number
  aiCount: number
  disabled?: boolean
  onDone: () => void
}) {
  const toast = useToast()
  const [st, setSt] = useState<AiFillState | null>(null)
  const autoTried = useRef(false)
  const running = st?.state === 'running'

  const start = useCallback(
    async (redo: boolean) => {
      try {
        setSt(await api.aiFill(appId, { answers, redo }))
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    [appId, answers, toast],
  )

  // Where it stands (a fill may be running from before the page opened).
  useEffect(() => {
    api.aiFillState(appId).then(setSt).catch(() => setSt({ state: 'idle', at: null }))
  }, [appId])

  // Once per post: fill by itself when questions are open and the AI hasn't looked yet.
  useEffect(() => {
    if (autoTried.current || !st || disabled) return
    if (st.state === 'idle' && missing > 0) {
      autoTried.current = true
      void start(false)
    }
  }, [st, missing, disabled, start])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      api.aiFillState(appId).then((s) => {
        setSt(s)
        if (s.state === 'done') {
          onDone()
          toast(s.filled ? `The AI filled ${s.filled} answer${s.filled > 1 ? 's' : ''} — check the ones marked “AI”.` : 'Nothing new for the AI to fill.', s.filled ? 'success' : 'info')
        } else if (s.state === 'failed') {
          onDone()
          toast(s.message || 'The AI fill failed.', 'error')
        }
      }).catch(() => {})
    }, 2500)
    return () => clearInterval(t)
  }, [running, appId, onDone, toast])

  return (
    <div className="ai-fill">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn primary sm" disabled={disabled || running} onClick={() => start(false)} title="Answer the empty questions from your profile, saved answers, resume and the job post. Nothing is sent.">
          {running ? <span className="spin" /> : <Sparkle />}
          {running ? 'The AI is filling the answers…' : 'Fill empty answers with AI'}
        </button>
        {aiCount > 0 && !running && (
          <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => window.confirm('Ask the AI again for every answer marked “AI”? Your own answers stay.') && start(true)}>
            Redo AI answers
          </button>
        )}
        <span className="muted small">Uses your resume, profile, saved answers and the job post. Nothing is sent until you press Apply.</span>
      </div>
      {st?.message && st.state !== 'idle' && !running && (
        <p className={`small ${st.state === 'failed' ? 'error-text' : 'muted'}`} style={{ margin: '6px 0 0' }}>{st.message}</p>
      )}
    </div>
  )
}

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6zM19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9zM5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8L2.5 17.5l1.8-.7z" />
    </svg>
  )
}
