import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useToast } from '../Toast'

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export default function ApplicationDetail({ id, onClose, onChanged }) {
  const [app, setApp] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // email pane
  const [emailDraft, setEmailDraft] = useState(null)
  // gform pane
  const [formData, setFormData] = useState(null) // {form, answers, unanswered_required}
  const [formLoading, setFormLoading] = useState(false)

  const load = useCallback(async () => {
    const rec = await api.getApplication(id)
    setApp(rec)
    return rec
  }, [id])

  useEffect(() => {
    load().then((rec) => {
      if (rec.method === 'email') {
        api.emailPreview(id).then(setEmailDraft).catch(() => {})
      }
    })
  }, [id, load])

  const patch = async (fields) => {
    const updated = await api.patchApplication(id, fields)
    setApp(updated)
    onChanged()
    return updated
  }

  const saveParsed = async () => {
    try {
      await patch({
        job_title: app.job_title || '',
        company: app.company || '',
        location: app.location || '',
        experience: app.experience || '',
        email_to: app.email_to || '',
        form_url: app.form_url || '',
        method: app.method,
        notes: app.notes || '',
      })
      toast('Saved.', 'success')
      if (app.method === 'email') {
        api.emailPreview(id).then(setEmailDraft).catch(() => {})
      }
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const setField = (k) => (v) => setApp((a) => ({ ...a, [k]: v }))

  const loadForm = async () => {
    setFormLoading(true)
    try {
      const data = await api.loadForm(id)
      setFormData(data)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setFormLoading(false)
    }
  }

  const setAnswer = (key, value) => {
    setFormData((fd) => ({ ...fd, answers: { ...fd.answers, [key]: value } }))
  }

  const sendEmail = async () => {
    if (!confirm(`Send application email to ${emailDraft.to}?`)) return
    setBusy(true)
    try {
      const updated = await api.apply(id, {
        to: emailDraft.to,
        subject: emailDraft.subject,
        body: emailDraft.body,
      })
      setApp(updated)
      onChanged()
      toast(updated.status === 'applied' ? 'Email sent — marked as applied.' : `Failed: ${updated.error}`,
        updated.status === 'applied' ? 'success' : 'error')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitForm = async () => {
    if (!confirm('Submit the Google Form with these answers?')) return
    setBusy(true)
    try {
      const updated = await api.apply(id, { answers: formData.answers })
      setApp(updated)
      onChanged()
      toast(updated.status === 'applied' ? 'Form submitted — marked as applied.' : `Failed: ${updated.error}`,
        updated.status === 'applied' ? 'success' : 'error')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (status) => {
    try {
      await patch({ status })
      toast(`Marked as ${status}.`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const remove = async () => {
    if (!confirm('Delete this application permanently?')) return
    await api.deleteApplication(id)
    onChanged()
    onClose()
  }

  if (!app) return null

  const applied = app.status === 'applied'

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="sheet">
        <div className="grabber" />
        <div className="sheet-head">
          <div>
            <h2>{app.job_title || 'Untitled application'}</h2>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${app.method}`}>{app.method}</span>
              <span className={`badge ${app.status}`}>{app.status}</span>
              {app.channel && <span className="muted" style={{ fontSize: 12 }}>from {app.channel}</span>}
            </div>
          </div>
          <button className="icon-btn" style={{ width: 38, height: 38 }} onClick={onClose}>
            <span style={{ fontSize: 15 }}>✕</span>
          </button>
        </div>

        {app.status_reason && <p className="muted" style={{ marginBottom: 10 }}>ℹ {app.status_reason}</p>}
        {app.error && <p className="error-text" style={{ marginBottom: 10 }}>⚠ {app.error}</p>}

        <div className="section">
          <h3>Original message</h3>
          <div className="raw-text">{app.raw_text}</div>
        </div>

        <div className="section">
          <h3>Parsed details</h3>
          <div className="stack">
            <div className="grid-2">
              <Field label="Job title" value={app.job_title} onChange={setField('job_title')} />
              <Field label="Company" value={app.company} onChange={setField('company')} />
              <Field label="Location" value={app.location} onChange={setField('location')} />
              <Field label="Experience" value={app.experience} onChange={setField('experience')} />
            </div>
            <div className="grid-2">
              <label className="field">
                <span className="lbl">Apply via</span>
                <select value={app.method} onChange={(e) => setField('method')(e.target.value)}>
                  <option value="email">Email</option>
                  <option value="gform">Google Form</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              {app.method === 'gform'
                ? <Field label="Form URL" value={app.form_url} onChange={setField('form_url')} />
                : <Field label="HR email" value={app.email_to} onChange={setField('email_to')} />}
            </div>
            <Field label="Notes" value={app.notes} onChange={setField('notes')} placeholder="Private notes…" />
            <div>
              <button className="btn sm" onClick={saveParsed}>Save details</button>
            </div>
          </div>
        </div>

        {app.method === 'email' && emailDraft && (
          <div className="section">
            <h3>Email application</h3>
            <div className="stack">
              <Field label="To" value={emailDraft.to} onChange={(v) => setEmailDraft((d) => ({ ...d, to: v }))} />
              <Field label="Subject" value={emailDraft.subject} onChange={(v) => setEmailDraft((d) => ({ ...d, subject: v }))} />
              <label className="field">
                <span className="lbl">Body</span>
                <textarea rows={12} value={emailDraft.body} onChange={(e) => setEmailDraft((d) => ({ ...d, body: e.target.value }))} />
              </label>
              <p className="muted" style={{ fontSize: 12 }}>
                {emailDraft.attachment
                  ? `📎 Resume will be attached: ${emailDraft.attachment}`
                  : '⚠ No resume path set in Settings → Profile; email goes without attachment.'}
              </p>
              <div className="row-actions">
                <button className="btn success" disabled={busy || applied || !emailDraft.to} onClick={sendEmail}>
                  {busy ? 'Sending…' : applied ? 'Already applied' : '✉ Send application'}
                </button>
              </div>
            </div>
          </div>
        )}

        {app.method === 'gform' && (
          <div className="section">
            <h3>Google Form application</h3>
            {!formData ? (
              <div className="row-actions" style={{ marginTop: 0 }}>
                <button className="btn primary" disabled={formLoading || !app.form_url} onClick={loadForm}>
                  {formLoading ? 'Fetching form…' : 'Load form & auto-fill'}
                </button>
                {app.form_url && (
                  <a className="btn" href={app.form_url} target="_blank" rel="noreferrer">Open form ↗</a>
                )}
              </div>
            ) : (
              <div className="stack">
                <p><strong>{formData.form.title}</strong></p>
                {formData.form.collects_email && (
                  <div className="question">
                    <div className="q-title">Your email (collected by form) <span className="req">*</span></div>
                    <input
                      value={formData.answers.emailAddress || ''}
                      onChange={(e) => setAnswer('emailAddress', e.target.value)}
                    />
                  </div>
                )}
                {formData.form.fields.map((f) => {
                  const key = `entry.${f.entry_id}`
                  const val = formData.answers[key]
                  return (
                    <div key={key} className={`question ${f.supported ? '' : 'unsupported'}`}>
                      <div className="q-title">
                        {f.title} {f.required && <span className="req">*</span>}
                      </div>
                      {f.description && <div className="q-meta">{f.description}</div>}
                      {!f.supported && (
                        <div className="error-text">
                          {f.type === 'file_upload'
                            ? 'File upload — cannot be automated (requires Google sign-in). Submit this form manually.'
                            : `Unsupported question type (${f.type}). Submit this form manually.`}
                        </div>
                      )}
                      {f.supported && (f.type === 'short_answer' || f.type === 'paragraph') && (
                        f.type === 'paragraph'
                          ? <textarea rows={4} value={val || ''} onChange={(e) => setAnswer(key, e.target.value)} />
                          : <input value={val || ''} onChange={(e) => setAnswer(key, e.target.value)} />
                      )}
                      {f.supported && (f.type === 'multiple_choice' || f.type === 'dropdown' || f.type === 'linear_scale') && (
                        <select value={val || ''} onChange={(e) => setAnswer(key, e.target.value)}>
                          <option value="">— select —</option>
                          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {f.supported && f.type === 'checkboxes' && (
                        <div className="check-list">
                          {f.options.map((o) => {
                            const arr = Array.isArray(val) ? val : []
                            return (
                              <label key={o}>
                                <input
                                  type="checkbox"
                                  checked={arr.includes(o)}
                                  onChange={(e) => setAnswer(key, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
                                />
                                {o}
                              </label>
                            )
                          })}
                        </div>
                      )}
                      {f.supported && f.type === 'date' && (
                        <input
                          type="date"
                          value={val && typeof val === 'object'
                            ? `${val.year}-${String(val.month).padStart(2, '0')}-${String(val.day).padStart(2, '0')}`
                            : ''}
                          onChange={(e) => {
                            const [y, m, d] = e.target.value.split('-')
                            setAnswer(key, y ? { year: y, month: String(+m), day: String(+d) } : '')
                          }}
                        />
                      )}
                    </div>
                  )
                })}
                <div className="row-actions">
                  <button className="btn success" disabled={busy || applied} onClick={submitForm}>
                    {busy ? 'Submitting…' : applied ? 'Already applied' : '✓ Submit form'}
                  </button>
                  <button className="btn" onClick={loadForm} disabled={formLoading}>↻ Re-fetch / re-fill</button>
                  <a className="btn" href={app.form_url} target="_blank" rel="noreferrer">Open form ↗</a>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="section">
          <h3>Actions</h3>
          <div className="row-actions" style={{ marginTop: 0 }}>
            {!applied && <button className="btn" onClick={() => setStatus('applied')}>Mark applied manually</button>}
            {app.status !== 'skipped' && <button className="btn" onClick={() => setStatus('skipped')}>Skip</button>}
            {(app.status === 'skipped' || app.status === 'failed') && (
              <button className="btn" onClick={() => setStatus('review')}>Back to review</button>
            )}
            <button className="btn danger" onClick={remove}>Delete</button>
          </div>
        </div>
      </div>
    </>
  )
}
