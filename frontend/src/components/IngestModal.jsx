import { useState } from 'react'
import { api } from '../api'
import { useToast } from '../Toast'

export default function IngestModal({ onClose, onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const rec = await api.ingest(text, 'pasted')
      toast(`Message parsed — method: ${rec.method}${rec.job_title ? `, role: ${rec.job_title}` : ''}`, 'success')
      onDone()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="sheet">
        <div className="grabber" />
        <div className="sheet-head">
          <h2>Paste a job message</h2>
          <button className="icon-btn" style={{ width: 38, height: 38 }} onClick={onClose}>
            <span style={{ fontSize: 15 }}>✕</span>
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Paste the raw Telegram message. It will be parsed for the role, company
          and the HR email / Google Form link.
        </p>
        <textarea
          rows={12}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'e.g.\nHiring: React Developer\nCompany: Acme Corp\nExperience: 2+ years\nSend resume to hr@acme.com'}
        />
        <div className="row-actions">
          <button className="btn primary" disabled={busy || !text.trim()} onClick={submit}>
            {busy ? 'Parsing…' : 'Parse & add'}
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}
