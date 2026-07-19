import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { useToast } from '../Toast'
import PageHeader from '../components/PageHeader'
import QuickFill from '../components/QuickFill'
import Bookmarklet from '../components/Bookmarklet'
import { MailIcon, FormIcon, ListIcon, GearIcon, LinkIcon } from '../components/Icons'

// Build an embeddable form URL. When we have the parsed schema + answers, add
// Google's prefill params (entry.ID=value) so the embedded form loads already
// filled in — the user just reviews and submits inside the app.
function buildEmbedUrl(app, formData) {
  let base = (formData?.form?.url || app.form_url || '')
  base = base.split('#')[0].split('?')[0]
  if (base.endsWith('/formResponse')) base = base.replace(/\/formResponse$/, '/viewform')
  if (!base) return ''
  const params = new URLSearchParams()
  params.set('embedded', 'true')
  if (formData?.form && formData?.answers) {
    params.set('usp', 'pp_url')
    const { form, answers } = formData
    if (form.collects_email && answers.emailAddress) params.append('emailAddress', String(answers.emailAddress))
    for (const f of form.fields) {
      const v = answers[`entry.${f.entry_id}`]
      if (v == null || v === '') continue
      const key = `entry.${f.entry_id}`
      if (Array.isArray(v)) v.forEach((x) => x && params.append(key, String(x)))
      else if (typeof v === 'object') { /* dates aren't reliably prefillable via URL — skip */ }
      else params.append(key, String(v))
    }
  }
  return `${base}?${params.toString()}`
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export default function ApplicationDetail({ id }) {
  const [app, setApp] = useState(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const toast = useToast()

  const [emailDraft, setEmailDraft] = useState(null)
  const [emailEdited, setEmailEdited] = useState(false) // don't clobber manual edits
  const [formData, setFormData] = useState(null) // {form, answers, unanswered_required}
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState(null)
  const [formMode, setFormMode] = useState('embed') // 'embed' | 'fields'

  const editDraft = (patch) => {
    setEmailEdited(true)
    setEmailDraft((d) => ({ ...d, ...patch }))
  }

  const load = useCallback(async () => {
    const rec = await api.getApplication(id)
    setApp(rec)
    return rec
  }, [id])

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) { setMissing(true); return }
    load().then((rec) => {
      // A single post can offer several ways to apply — prep whichever exist.
      const rx = rec.extra || {}
      if (rx.all_emails?.length || rec.email_to) {
        api.emailPreview(id).then((d) => { setEmailDraft(d); setEmailEdited(false) }).catch(() => {})
      }
      if ((rx.all_form_urls?.length || rec.form_url) && rec.method === 'gform') {
        // Auto-load the pre-filled draft when the form is the primary method.
        loadForm({ silent: true })
      }
    }).catch(() => setMissing(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load])

  const patch = async (fields) => {
    const updated = await api.patchApplication(id, fields)
    setApp(updated)
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
        apply_url: app.apply_url || '',
        method: app.method,
        notes: app.notes || '',
      })
      toast('Saved.', 'success')
      // Only regenerate the draft from the template if the user hasn't hand-edited it.
      if (app.method === 'email' && !emailEdited) {
        api.emailPreview(id).then((d) => { setEmailDraft(d); setEmailEdited(false) }).catch(() => {})
      }
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const setField = (k) => (v) => setApp((a) => ({ ...a, [k]: v }))

  const loadForm = async ({ silent = false } = {}) => {
    setFormLoading(true)
    setFormError(null)
    try {
      setFormData(await api.loadForm(id))
    } catch (e) {
      setFormError(e.message)
      if (!silent) toast(e.message, 'error')
    } finally {
      setFormLoading(false)
    }
  }

  const setAnswer = (key, value) => {
    setFormData((fd) => ({ ...fd, answers: { ...fd.answers, [key]: value } }))
  }

  const sendEmail = async () => {
    if (!window.confirm(`Send application email to ${emailDraft.to}?`)) return
    setBusy(true)
    try {
      const updated = await api.apply(id, {
        to: emailDraft.to, subject: emailDraft.subject, body: emailDraft.body,
      })
      setApp(updated)
      toast(updated.status === 'applied' ? 'Email sent — marked as applied.' : `Failed: ${updated.error}`,
        updated.status === 'applied' ? 'success' : 'error')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitForm = async () => {
    if (!window.confirm('Submit the Google Form with these answers?')) return
    setBusy(true)
    try {
      const updated = await api.apply(id, { answers: formData.answers })
      setApp(updated)
      if (updated.needs_input) {
        toast(`${updated.unanswered_required?.length || 'Some'} required question(s) still need an answer.`, 'error')
      } else {
        toast(updated.status === 'applied' ? 'Form submitted — marked as applied.' : `Failed: ${updated.error}`,
          updated.status === 'applied' ? 'success' : 'error')
      }
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
    if (!window.confirm('Delete this application permanently?')) return
    try {
      await api.deleteApplication(id)
      toast('Deleted.')
      navigate('/applications')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  if (missing) {
    return (
      <>
        <PageHeader title="Not found" backTo="/applications" />
        <div className="card">
          <p className="muted">This application doesn't exist (it may have been deleted).</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => navigate('/applications')}>Back to applications</button>
          </div>
        </div>
      </>
    )
  }
  if (!app) {
    return (
      <>
        <PageHeader title="Application" backTo="/applications" />
        <p className="muted">Loading…</p>
      </>
    )
  }

  const applied = app.status === 'applied'
  const rawLong = (app.raw_text || '').length > 400

  // Every way this post can be applied to — a single message may list an email,
  // a Google Form, and an external link all at once. Data comes from the parser
  // (all_emails / all_form_urls / other_urls), so nothing is lost to the primary
  // method being just one of them.
  const extra = app.extra || {}
  const emails = extra.all_emails?.length ? extra.all_emails : (app.email_to ? [app.email_to] : [])
  const forms = extra.all_form_urls?.length ? extra.all_form_urls : (app.form_url ? [app.form_url] : [])
  const emailSet = new Set(emails.map((e) => String(e).toLowerCase()))
  const links = [...new Set([app.apply_url, ...(extra.other_urls || [])].filter(Boolean))]
    .filter((u) => !forms.includes(u) && !emailSet.has(String(u).toLowerCase()))
  const hasEmail = emails.length > 0
  const hasForm = forms.length > 0
  const hasLink = links.length > 0
  const optionCount = (hasEmail ? 1 : 0) + (hasForm ? 1 : 0) + (hasLink ? 1 : 0)

  // Which required questions are still blank — drives the banner + highlight.
  const isEmptyAns = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
  const missingKeys = new Set()
  if (formData?.form) {
    const { form, answers } = formData
    if (form.collects_email && isEmptyAns(answers.emailAddress)) missingKeys.add('emailAddress')
    for (const f of form.fields) {
      if (f.required && f.supported && isEmptyAns(answers[`entry.${f.entry_id}`])) {
        missingKeys.add(`entry.${f.entry_id}`)
      }
    }
  }

  return (
    <>
      <PageHeader title={app.job_title || 'Untitled application'}
        sub={[app.company, app.location].filter(Boolean).join(' · ') || null}
        backTo="/applications" />

      <div className="settings-stack">
        <div className="badge-row">
          <span className={`badge ${app.method}`}>{app.method}</span>
          <span className={`badge ${app.status}`}>{app.status}</span>
          {app.channel && <span className="muted" style={{ fontSize: 12 }}>from {app.channel}</span>}
        </div>

        {app.status_reason && <p className="muted" style={{ fontSize: 13 }}>ℹ {app.status_reason}</p>}
        {app.error && <p className="error-text">⚠ {app.error}</p>}
        {optionCount > 1 && (
          <p className="muted" style={{ fontSize: 13 }}>
            This post lists <strong style={{ color: 'var(--text)' }}>{optionCount} ways to apply</strong> — use any of the options below
            ({[hasEmail && 'email', hasForm && 'form', hasLink && 'link'].filter(Boolean).join(' · ')}).
          </p>
        )}

        <div className="card">
          <h3><ListIcon style={{ width: 18, height: 18 }} /> Original message</h3>
          <div className={`raw-text ${rawLong && !rawOpen ? 'clamped' : ''}`}>{app.raw_text}</div>
          {rawLong && (
            <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setRawOpen((v) => !v)}>
              {rawOpen ? 'Show less' : 'Show full message'}
            </button>
          )}
        </div>

        <div className="card">
          <h3><GearIcon style={{ width: 18, height: 18 }} /> Details</h3>
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
                  <option value="link">External page (open link)</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              {app.method === 'gform'
                ? <Field label="Form URL" value={app.form_url} onChange={setField('form_url')} />
                : app.method === 'link'
                  ? <Field label="Application URL" value={app.apply_url} onChange={setField('apply_url')} />
                  : <Field label="HR email" value={app.email_to} onChange={setField('email_to')} />}
            </div>
            <Field label="Notes" value={app.notes} onChange={setField('notes')} placeholder="Private notes…" />
            <div>
              <button className="btn sm" onClick={saveParsed}>Save details</button>
            </div>
          </div>
        </div>

        {hasEmail && emailDraft && (
          <div className="card">
            <h3><MailIcon style={{ width: 18, height: 18 }} /> Email application</h3>
            <div className="stack">
              {emails.length > 1 && (
                <label className="field">
                  <span className="lbl">Send to (this post lists {emails.length} addresses)</span>
                  <select value={emailDraft.to || ''} onChange={(e) => editDraft({ to: e.target.value })}>
                    {emails.map((em) => <option key={em} value={em}>{em}</option>)}
                  </select>
                </label>
              )}
              <Field label="To" value={emailDraft.to} onChange={(v) => editDraft({ to: v })} />
              <Field label="Subject" value={emailDraft.subject} onChange={(v) => editDraft({ subject: v })} />
              <label className="field">
                <span className="lbl">Body</span>
                <textarea rows={12} value={emailDraft.body} onChange={(e) => editDraft({ body: e.target.value })} />
              </label>
              <p className="muted" style={{ fontSize: 12 }}>
                {emailDraft.attachment
                  ? `📎 Resume will be attached: ${emailDraft.attachment}`
                  : '⚠ No resume path set in Settings → Profile; email goes without attachment.'}
              </p>
              <div className="row-actions" style={{ marginTop: 0 }}>
                <button className="btn success" disabled={busy || applied || !emailDraft.to} onClick={sendEmail}>
                  {busy ? 'Sending…' : applied ? 'Already applied' : '✉ Send application'}
                </button>
                {emailEdited && !applied && (
                  <button className="btn sm" title="Discard edits and rebuild from your template"
                    onClick={() => api.emailPreview(id).then((d) => { setEmailDraft(d); setEmailEdited(false) })}>
                    ↻ Reset to template
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {hasForm && (
          <div className="card">
            <h3><FormIcon style={{ width: 18, height: 18 }} /> Google Form application</h3>
            {!formData ? (
              formError ? (
                <div className="stack">
                  <p className="warn-text">{formError}</p>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    This form is sign-in-only, so it can’t be filled from here directly. Open it in your
                    browser (where you’re signed in) and use the one-click autofill below.
                  </p>
                  <div className="row-actions" style={{ marginTop: 0 }}>
                    {app.form_url && (
                      <a className="btn primary" href={app.form_url} target="_blank" rel="noreferrer">Open the form ↗</a>
                    )}
                    {!applied && <button className="btn success" onClick={() => setStatus('applied')}>Mark applied</button>}
                    <button className="btn" disabled={formLoading} onClick={() => loadForm()}>
                      {formLoading ? 'Retrying…' : '↻ Try again'}
                    </button>
                  </div>
                  <Bookmarklet />
                  <QuickFill />
                </div>
              ) : (
                <div className="row-actions" style={{ marginTop: 0 }}>
                  <button className="btn primary" disabled={formLoading || !app.form_url} onClick={() => loadForm()}>
                    {formLoading ? 'Fetching form…' : 'Load form & auto-fill'}
                  </button>
                  {app.form_url && (
                    <a className="btn" href={app.form_url} target="_blank" rel="noreferrer">Open form ↗</a>
                  )}
                </div>
              )
            ) : (
              <div className="stack">
                <p><strong>{formData.form.title}</strong></p>
                <div className="seg" style={{ maxWidth: 300 }}>
                  <button className={formMode === 'embed' ? 'on' : ''} onClick={() => setFormMode('embed')}>Fill in app</button>
                  <button className={formMode === 'fields' ? 'on' : ''} onClick={() => setFormMode('fields')}>Auto-submit</button>
                </div>
                {formMode === 'embed' && (
                  <div className="stack">
                    <p className="muted" style={{ fontSize: 12.5 }}>
                      The form is loaded here <strong>pre-filled from your profile</strong>. Review it,
                      complete anything blank, and hit Submit inside the form.
                    </p>
                    <iframe title="Google Form" className="form-embed" src={buildEmbedUrl(app, formData)} />
                    <div className="row-actions" style={{ marginTop: 0 }}>
                      <a className="btn" href={app.form_url} target="_blank" rel="noreferrer">Open in new tab ↗</a>
                      {!applied && <button className="btn success" onClick={() => setStatus('applied')}>Mark applied</button>}
                    </div>
                    <Bookmarklet />
                  </div>
                )}
                {formMode === 'fields' && (
                <div className="stack">
                {missingKeys.size > 0 ? (
                  <p className="warn-text">
                    ✎ {missingKeys.size} required question{missingKeys.size > 1 ? 's' : ''} still
                    need{missingKeys.size > 1 ? '' : 's'} an answer — the rest are pre-filled from your
                    profile. Complete the highlighted field{missingKeys.size > 1 ? 's' : ''}, then submit.
                  </p>
                ) : (
                  <p className="success-text">✓ Everything required is filled from your profile — ready to submit.</p>
                )}
                {formData.form.collects_email && (
                  <div className={`question ${missingKeys.has('emailAddress') ? 'missing' : ''}`}>
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
                    <div key={key} className={`question ${f.supported ? '' : 'unsupported'} ${missingKeys.has(key) ? 'missing' : ''}`}>
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
                <div className="row-actions" style={{ marginTop: 0 }}>
                  <button className="btn success" disabled={busy || applied} onClick={submitForm}>
                    {busy ? 'Submitting…' : applied ? 'Already applied' : '✓ Submit form'}
                  </button>
                  <button className="btn" onClick={() => loadForm()} disabled={formLoading}>↻ Re-fetch / re-fill</button>
                  <a className="btn" href={app.form_url} target="_blank" rel="noreferrer">Open form ↗</a>
                </div>
                </div>
                )}
              </div>
            )}
          </div>
        )}

        {hasLink && (
          <div className="card">
            <h3><LinkIcon style={{ width: 18, height: 18 }} /> Apply on an external page</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              {links.length > 1 ? 'These links were' : 'This link was'} found in the post
              (company careers page / Workday / Microsoft Forms). They can’t be auto-filled — open,
              apply there, then mark it applied here. Use the copy panel below to fill fields fast.
            </p>
            <div className="link-list">
              {links.map((u) => (
                <div key={u} className="link-row">
                  <a className="btn sm primary" href={u} target="_blank" rel="noreferrer">Open ↗</a>
                  <span className="link-url">{u}</span>
                </div>
              ))}
            </div>
            <div className="row-actions" style={{ marginTop: 12 }}>
              {!applied && <button className="btn success" onClick={() => setStatus('applied')}>Mark applied</button>}
            </div>
            <QuickFill />
          </div>
        )}

        <div className="card">
          <h3><GearIcon style={{ width: 18, height: 18 }} /> Actions</h3>
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
