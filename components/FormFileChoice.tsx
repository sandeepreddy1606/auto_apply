'use client'

/**
 * The file for one Google Form upload question: automatic (your resume for
 * this role, on resume questions), one of your resumes, a file you upload
 * here (photo, certificate, cover letter …), or nothing.
 */
import { useRef, useState } from 'react'

import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { FormFilesView } from '@/lib/api'

const AUTO = '__auto'
const SKIP = '__skip'
const UPLOAD = '__upload'

export default function FormFileChoice({
  appId,
  entry,
  view,
  onChange,
  disabled,
}: {
  appId: number
  entry: string
  view: FormFilesView
  onChange: (v: FormFilesView) => void
  disabled?: boolean
}) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const q = view.questions.find((x) => x.key === entry)
  const choice = view.choices[entry]
  const value = !choice ? AUTO : choice.kind === 'skip' ? SKIP : choice.kind === 'resume' ? `r:${choice.id}` : `f:${choice.name}`

  const run = async (p: Promise<FormFilesView>) => {
    setBusy(true)
    try {
      onChange(await p)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pick = (v: string) => {
    if (v === UPLOAD) return input.current?.click()
    if (v === AUTO) return run(api.chooseFormFile(appId, entry, null))
    if (v === SKIP) return run(api.chooseFormFile(appId, entry, { kind: 'skip' }))
    if (v.startsWith('r:')) return run(api.chooseFormFile(appId, entry, { kind: 'resume', id: v.slice(2) }))
    return run(api.chooseFormFile(appId, entry, { kind: 'file', name: v.slice(2) }))
  }

  const autoLabel = !choice && q?.name ? `Automatic — ${q.name} (your resume for this role)` : 'Automatic — your resume, on resume questions'
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={value} disabled={disabled || busy} onChange={(e) => pick(e.target.value)} style={{ flex: '1 1 260px' }} aria-label="File for this question">
          <option value={AUTO}>{autoLabel}</option>
          {view.resumes.length > 0 && (
            <optgroup label="Your resumes">
              {view.resumes.map((r) => (
                <option key={r.id} value={`r:${r.id}`}>{r.name}</option>
              ))}
            </optgroup>
          )}
          {view.uploaded.length > 0 && (
            <optgroup label="Uploaded for this post">
              {view.uploaded.map((f) => (
                <option key={f.name} value={`f:${f.name}`}>{f.name}</option>
              ))}
            </optgroup>
          )}
          <option value={UPLOAD}>Upload a file…</option>
          {!q?.required && <option value={SKIP}>Don’t attach anything</option>}
        </select>
        <button type="button" className="btn sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? <span className="spin" /> : null} Upload
        </button>
        {choice?.kind === 'file' && (
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(api.deleteFormFile(appId, choice.name))} title="Remove this uploaded file">
            Remove file
          </button>
        )}
      </div>
      <span className="muted small">
        {q?.name
          ? `Will attach: ${q.name}`
          : q?.required
            ? 'Needs a file — choose one or upload it.'
            : 'Nothing will be attached.'}
      </span>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void run(api.uploadFormFile(appId, f, entry))
        }}
      />
    </div>
  )
}
