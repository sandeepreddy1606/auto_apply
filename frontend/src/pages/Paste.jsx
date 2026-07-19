import { useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { useToast } from '../Toast'
import PageHeader from '../components/PageHeader'

export default function Paste() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const res = await api.ingest(text, 'pasted')
      const created = res.created || []
      if (created.length === 1) {
        const rec = created[0]
        toast(`Parsed — method: ${rec.method}${rec.job_title ? `, role: ${rec.job_title}` : ''}`, 'success')
        navigate(`/applications/${rec.id}`)
      } else {
        toast(`${created.length} openings added from this message.`, 'success')
        navigate('/applications')
      }
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Paste a job message" backTo="/" />
      <div className="card">
        <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
          Paste the raw job post (from Telegram, WhatsApp, anywhere). It's parsed for the
          role, company and the HR email / Google Form link, then opens ready to review.
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
            {busy ? 'Parsing…' : 'Parse & review'}
          </button>
          <button className="btn" onClick={() => navigate('/')}>Cancel</button>
        </div>
      </div>
    </>
  )
}
