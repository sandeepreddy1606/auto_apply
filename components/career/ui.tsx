'use client'

/** Small shared pieces for the career-flow pages. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useNavigate } from '@/components/Navigation'
import { authedBlobUrl } from '@/lib/career-api'
import type { Gate } from '@/lib/career-api'
import type { ScoreBreakdown, SessionStatus } from '@/lib/types'

export function ScorePill({ score, breakdown }: { score: number | null; breakdown?: ScoreBreakdown | null }) {
  if (score == null) return <span className="score" title="Not scored yet">–</span>
  if (breakdown?.excluded) return <span className="score x" title={`Filtered: ${breakdown.excluded}`}>{score}</span>
  const cls = score >= 75 ? 'hi' : score >= 55 ? 'mid' : 'lo'
  return <span className={`score ${cls}`}>{score}</span>
}

export const STATUS_LABEL: Record<SessionStatus, [string, string]> = {
  created: ['Started', 'info'],
  resume_drafting: ['Resume draft', 'info'],
  resume_ready: ['Resume ready', 'ok'],
  filling: ['Filling…', 'info'],
  needs_input: ['Needs you', 'warn'],
  reviewing: ['Ready to review', 'purple'],
  blocked: ['Blocked', 'bad'],
  submitting: ['Submitting…', 'info'],
  unconfirmed: ['Did it go through?', 'warn'],
  submitted: ['Submitted', 'ok'],
  failed: ['Failed', 'bad'],
  cancelled: ['Cancelled', ''],
}

export function StatusPill({ status }: { status: SessionStatus | string | null }) {
  if (!status) return null
  const [label, cls] = STATUS_LABEL[status as SessionStatus] ?? [status, '']
  return <span className={`pill ${cls}`}>{label}</span>
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString()
}

/** A button that explains why it's disabled and links to the fix. */
export function GatedButton({
  gate,
  onClick,
  children,
  className = 'btn primary',
  busy,
}: {
  gate: Gate | undefined
  onClick: () => void
  children: ReactNode
  className?: string
  busy?: boolean
}) {
  const navigate = useNavigate()
  const ok = gate?.ok !== false
  return (
    <div>
      <button className={className} disabled={!ok || busy} onClick={onClick}>
        {busy ? <span className="spin" /> : null} {children}
      </button>
      {!ok && gate?.reason && (
        <div className="gate-note">
          {gate.reason}{' '}
          {gate.fix && (
            <button className="link-btn" onClick={() => navigate(gate.fix!)}>
              Fix →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Chips with an inline input: Enter or comma adds, × removes. */
export function ChipInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  suggestions?: string[]
}) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    const next = [...value]
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setDraft('')
  }
  const sugg = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
  return (
    <div>
      <div className="chip-input">
        {value.map((v) => (
          <span className="ci" key={v}>
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            if (e.target.value.endsWith(',')) add(e.target.value)
            else setDraft(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (draft.trim()) add(draft)
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      {sugg.length > 0 && (
        <div className="kw" style={{ marginTop: 8 }}>
          {sugg.slice(0, 12).map((s) => (
            <span key={s} className="miss" style={{ cursor: 'pointer' }} onClick={() => add(s)}>
              + {s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** <img> for an auth-protected URL (fetched with the bearer token). */
export function AuthedImage({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoke: string | null = null
    let alive = true
    authedBlobUrl(src)
      .then((r) => {
        if (!alive) return URL.revokeObjectURL(r.url)
        revoke = r.url
        setUrl(r.url)
      })
      .catch(() => setUrl(null))
    return () => {
      alive = false
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [src])
  if (!url) return <div className="skeleton" style={{ height: 80 }} />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} onClick={onClick} />
}

/** PDF preview from an auth-protected URL. Phones get an "Open PDF" button instead of an embed. */
export function PdfView({ src, stamp }: { src: string | null; stamp: string | number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!src) return
    let alive = true
    setErr(null)
    authedBlobUrl(src)
      .then((r) => {
        if (!alive) return URL.revokeObjectURL(r.url)
        if (last.current) URL.revokeObjectURL(last.current)
        last.current = r.url
        setUrl(r.url)
      })
      .catch((e) => setErr((e as Error).message))
    return () => {
      alive = false
    }
  }, [src, stamp])
  useEffect(() => () => {
    if (last.current) URL.revokeObjectURL(last.current)
  }, [])
  if (!src) return <div className="pdf-empty">Compile to see the PDF</div>
  if (err) return <div className="pdf-empty">{err}</div>
  if (!url) return <div className="pdf-empty"><span className="spin" /></div>
  return (
    <>
      <iframe className="pdf-frame" src={`${url}#view=FitH`} title="Resume PDF" />
      <div className="row-actions" style={{ marginTop: 8 }}>
        <a className="btn sm" href={url} target="_blank" rel="noreferrer">
          Open PDF
        </a>
      </div>
    </>
  )
}

export function Breakdown({ b }: { b: ScoreBreakdown }) {
  const rows: [string, number, string][] = [
    ['Title', b.title, b.title_match ? `matches “${b.title_match}”` : 'no role match'],
    ['Skills', b.skills, `${b.skills_have.length}/${b.skills_have.length + b.skills_missing.length}`],
    ['Experience', b.experience, b.experience_range ?? 'not stated'],
    ['Location', b.location, ''],
    ['Freshness', b.freshness, ''],
  ]
  return (
    <div className="breakdown">
      {rows.map(([k, v, d]) => (
        <div key={k}>
          <b>{k}</b>
          <span className="small">{d || `${Math.round(v * 100)}%`}</span>
          <div className="bar">
            <i style={{ width: `${Math.round(v * 100)}%`, background: v >= 0.8 ? 'var(--green)' : v >= 0.5 ? 'var(--amber)' : 'var(--red)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
