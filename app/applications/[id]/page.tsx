'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'

import AiFillBar from '@/components/AiFillBar'
import Bookmarklet from '@/components/Bookmarklet'
import FormFileChoice from '@/components/FormFileChoice'
import GoogleSignIn from '@/components/GoogleSignIn'
import { FormIcon, GearIcon, LinkIcon, ListIcon, MailIcon } from '@/components/Icons'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import QuickFill from '@/components/QuickFill'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { FormFilesView } from '@/lib/api'
import type {
  Application,
  EmailPreview,
  FormAnswer,
  FormAnswerMeta,
  FormLoadResult,
} from '@/lib/types'

/**
 * Build an embeddable form URL. When we have the parsed schema + answers, add
 * Google's prefill params (entry.ID=value) so the embedded form loads already
 * filled in — the user just reviews and submits inside the app.
 */
function buildEmbedUrl(app: Application, formData: FormLoadResult | null): string {
  let base = formData?.form?.url || app.form_url || ''
  base = base.split('#')[0].split('?')[0]
  if (base.endsWith('/formResponse')) base = base.replace(/\/formResponse$/, '/viewform')
  if (!base) return ''
  const params = new URLSearchParams()
  params.set('embedded', 'true')
  if (formData?.form && formData?.answers) {
    params.set('usp', 'pp_url')
    const { form, answers } = formData
    if (form.collects_email && answers.emailAddress) {
      params.append('emailAddress', String(answers.emailAddress))
    }
    for (const f of form.fields) {
      const v = answers[`entry.${f.entry_id}`]
      if (v == null || v === '') continue
      const key = `entry.${f.entry_id}`
      if (Array.isArray(v)) {
        v.forEach((x) => x && params.append(key, String(x)))
      } else if (typeof v === 'object') {
        /* dates aren't reliably prefillable via URL — skip */
      } else {
        params.append(key, String(v))
      }
    }
  }
  return `${base}?${params.toString()}`
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <input
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

const isEmptyAns = (v: unknown): boolean =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0)

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: rawId } = use(params)
  const id = Number(rawId)
  const navigate = useNavigate()
  const toast = useToast()

  const [app, setApp] = useState<Application | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)

  const [emailDraft, setEmailDraft] = useState<EmailPreview | null>(null)
  const [emailEdited, setEmailEdited] = useState(false) // don't clobber manual edits
  const [formData, setFormData] = useState<FormLoadResult | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<'embed' | 'fields'>('embed')
  const [files, setFiles] = useState<FormFilesView | null>(null)

  const editDraft = (patch: Partial<EmailPreview>) => {
    setEmailEdited(true)
    setEmailDraft((d) => (d ? { ...d, ...patch } : d))
  }

  const load = useCallback(async () => {
    const rec = await api.getApplication(id)
    setApp(rec)
    return rec
  }, [id])

  // A careers-page run in progress: follow it live.
  const applyingNow = app?.status === 'applying'
  useEffect(() => {
    if (!applyingNow) return
    const t = setInterval(() => void load().catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [applyingNow, load])

  // When a run finishes, show the answers and files it used.
  const wasApplying = useRef(false)
  useEffect(() => {
    if (applyingNow) wasApplying.current = true
    else if (wasApplying.current) {
      wasApplying.current = false
      if (app?.method === 'gform' || app?.form_url) void loadForm({ silent: true })
    }
  }, [applyingNow]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyOnCareersPage = async () => {
    if (!app) return
    setBusy(true)
    try {
      const updated = await api.apply(app.id)
      setApp(updated)
      toast(updated.status === 'applied' ? 'Applied.' : 'Applying on the careers page — progress shows here.', updated.status === 'applied' ? 'success' : 'info')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const loadForm = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      setFormLoading(true)
      setFormError(null)
      try {
        setFormData(await api.loadForm(id))
        api.formFiles(id).then(setFiles).catch(() => {})
      } catch (e) {
        setFormError((e as Error).message)
        if (!silent) toast((e as Error).message, 'error')
      } finally {
        setFormLoading(false)
      }
    },
    [id, toast],
  )

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setMissing(true)
      return
    }
    load()
      .then((rec) => {
        // A single post can offer several ways to apply — prep whichever exist.
        const rx = rec.extra || {}
        if (rx.all_emails?.length || rec.email_to) {
          api
            .emailPreview(id)
            .then((d) => {
              setEmailDraft(d)
              setEmailEdited(false)
            })
            .catch(() => {})
        }
        if ((rx.all_form_urls?.length || rec.form_url) && rec.method === 'gform') {
          // Auto-load the pre-filled draft when the form is the primary method.
          void loadForm({ silent: true })
        }
      })
      .catch(() => setMissing(true))
  }, [id, load, loadForm])

  const patch = async (fields: Partial<Application>) => {
    const updated = await api.patchApplication(id, fields)
    setApp(updated)
    return updated
  }

  const saveParsed = async () => {
    if (!app) return
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
        api
          .emailPreview(id)
          .then((d) => {
            setEmailDraft(d)
            setEmailEdited(false)
          })
          .catch(() => {})
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const setField =
    <K extends keyof Application>(k: K) =>
    (v: Application[K]) =>
      setApp((a) => (a ? { ...a, [k]: v } : a))

  // Editing an answer makes it yours (and it's remembered for later forms when you apply).
  const setAnswer = (key: string, value: FormAnswer) => {
    setFormData((fd) =>
      fd
        ? {
            ...fd,
            answers: { ...fd.answers, [key]: value },
            form: { ...fd.form, answer_meta: { ...(fd.form.answer_meta ?? {}), [key]: { source: 'you', note: fd.form.answer_meta?.[key]?.source === 'ai' ? 'edited' : undefined } } },
          }
        : fd,
    )
  }
  const reloadAfterAi = useCallback(() => void loadForm({ silent: true }), [loadForm])

  const sendEmail = async () => {
    if (!emailDraft) return
    if (!window.confirm(`Send application email to ${emailDraft.to}?`)) return
    setBusy(true)
    try {
      const updated = await api.apply(id, {
        to: emailDraft.to,
        subject: emailDraft.subject,
        body: emailDraft.body,
      })
      setApp(updated)
      toast(
        updated.status === 'applied'
          ? 'Email sent — marked as applied.'
          : `Failed: ${updated.error}`,
        updated.status === 'applied' ? 'success' : 'error',
      )
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitForm = async () => {
    if (!formData) return
    if (!window.confirm('Apply with these answers? Questions still empty are worked out first (AI included); anything it can’t answer comes back to you.')) return
    setBusy(true)
    try {
      const updated = await api.apply(id, { answers: formData.answers })
      setApp(updated)
      if (updated.needs_input) {
        toast(
          `${updated.unanswered_required?.length || 'Some'} required question(s) still need an answer.`,
          'error',
        )
      } else if (updated.status === 'applying') {
        toast('Applying — this page updates as it goes.', 'info')
      } else {
        toast(
          updated.status === 'applied'
            ? 'Form submitted — marked as applied.'
            : `Failed: ${updated.error}`,
          updated.status === 'applied' ? 'success' : 'error',
        )
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (status: Application['status']) => {
    try {
      await patch({ status })
      toast(`Marked as ${status}.`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete this application permanently?')) return
    try {
      await api.deleteApplication(id)
      toast('Deleted.')
      navigate('/applications')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (missing) {
    return (
      <>
        <PageHeader title="Not found" backTo="/applications" />
        <div className="card">
          <p className="muted">
            This application doesn&apos;t exist (it may have been deleted).
          </p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => navigate('/applications')}>
              Back to applications
            </button>
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
  // A Google Form that needs a Google account (also posts that failed with the old "sign-in" message).
  const needsGoogle =
    app.method === 'gform' &&
    (Boolean(app.form_schema?.signed_in) || /google account|google sign-in|restricted \(google/i.test(`${app.status_reason ?? ''} ${app.error ?? ''}`))
  const rawLong = (app.raw_text || '').length > 400

  // Every way this post can be applied to — a single message may list an email,
  // a Google Form, and an external link all at once. Data comes from the parser
  // (all_emails / all_form_urls / other_urls), so nothing is lost to the primary
  // method being just one of them.
  const extra = app.extra || {}
  const emails = extra.all_emails?.length
    ? extra.all_emails
    : app.email_to
      ? [app.email_to]
      : []
  const forms = extra.all_form_urls?.length
    ? extra.all_form_urls
    : app.form_url
      ? [app.form_url]
      : []
  const emailSet = new Set(emails.map((e) => String(e).toLowerCase()))
  const links = [...new Set([app.apply_url, ...(extra.other_urls || [])].filter(Boolean))]
    .filter(
      (u) => !forms.includes(u as string) && !emailSet.has(String(u).toLowerCase()),
    ) as string[]
  const hasEmail = emails.length > 0
  const hasForm = forms.length > 0
  const hasLink = links.length > 0
  const optionCount = (hasEmail ? 1 : 0) + (hasForm ? 1 : 0) + (hasLink ? 1 : 0)

  // Which required questions are still blank — drives the banner + highlight.
  const missingKeys = new Set<string>()
  if (formData?.form) {
    const { form, answers } = formData
    if (form.collects_email && isEmptyAns(answers.emailAddress)) {
      missingKeys.add('emailAddress')
    }
    for (const f of form.fields) {
      if (f.required && f.supported && isEmptyAns(answers[`entry.${f.entry_id}`])) {
        missingKeys.add(`entry.${f.entry_id}`)
      }
    }
    // Upload questions: missing when no file will be attached.
    for (const q of files?.questions ?? []) if (q.required && !q.name) missingKeys.add(q.key)
  }

  return (
    <>
      <PageHeader
        title={app.job_title || 'Untitled application'}
        sub={[app.company, app.location].filter(Boolean).join(' · ') || null}
        backTo="/applications"
      />

      <div className="settings-stack">
        <div className="badge-row">
          <span className={`badge ${app.method}`}>{{ email: 'HR email', gform: 'Google Form', link: 'Careers page', unknown: 'No apply method' }[app.method] ?? app.method}</span>
          <span className={`badge ${app.status}`}>{app.status}</span>
          {app.channel && (
            <span className="muted" style={{ fontSize: 12 }}>
              from {app.channel}
              {app.posted_at ? `, posted ${new Date(app.posted_at).toLocaleString()}` : ''}
            </span>
          )}
        </div>

        {app.status_reason && !(needsGoogle && !applied) && (
          <p className="muted" style={{ fontSize: 13 }}>
            ℹ {app.status_reason}
          </p>
        )}
        {needsGoogle && !applied ? (
          <div className="card gform-signin">
            <div className="card-title">This form needs your Google account</div>
            <p className="muted small" style={{ margin: '4px 0 12px' }}>
              1. Sign in to Google once in the automation browser (a window opens; sign in there and close it).
              2. Press Apply: the form opens signed in, is filled from your profile, gets your resume attached and is submitted.
            </p>
            {app.status === 'applying' && <div className="ok-box" style={{ marginBottom: 12 }}><span className="spin" /> {app.status_reason || 'Filling the form…'}</div>}
            {app.status !== 'applying' && app.status_reason && !/needs your Google account/i.test(app.status_reason) && (
              <div className="warn-box" style={{ marginBottom: 12 }}>{app.status_reason}</div>
            )}
            <div className="row-actions" style={{ marginTop: 0 }}>
              <GoogleSignIn compact />
              {app.status !== 'applying' && (
                <button className="btn primary" disabled={busy} onClick={applyOnCareersPage}>
                  {busy ? <span className="spin" /> : null} Apply with my Google account
                </button>
              )}
            </div>
          </div>
        ) : (
          app.error && <p className="error-text">⚠ {app.error}</p>
        )}
        {optionCount > 1 && (
          <p className="muted" style={{ fontSize: 13 }}>
            This post lists{' '}
            <strong style={{ color: 'var(--text)' }}>{optionCount} ways to apply</strong> —
            use any of the options below (
            {[hasEmail && 'email', hasForm && 'form', hasLink && 'link']
              .filter(Boolean)
              .join(' · ')}
            ).
          </p>
        )}

        {app.method === 'link' && app.apply_url && (
          <div className="card careers-card">
            <h3>
              <LinkIcon style={{ width: 18, height: 18 }} /> Apply on the careers page
            </h3>
            <p className="muted small" style={{ marginBottom: 12 }}>
              Opens <b style={{ color: 'var(--text)' }}>{(() => { try { return new URL(app.apply_url).hostname.replace(/^www\./, '') } catch { return app.apply_url } })()}</b> in the
              automation browser, attaches your PDF resume, fills the form from your profile and application answers, and
              submits when every required answer is filled (Settings → Automation). Sign-ins, CAPTCHAs and consent boxes wait for you.
            </p>
            {app.status === 'applying' && (
              <div className="ok-box" style={{ marginBottom: 12 }}><span className="spin" /> {app.status_reason || 'Applying…'}</div>
            )}
            <div className="row-actions" style={{ marginTop: 0 }}>
              {app.status === 'applied' ? (
                <span className="ok-text">Applied {app.applied_at ? new Date(app.applied_at).toLocaleString() : ''}</span>
              ) : app.status !== 'applying' ? (
                <button className="btn primary" disabled={busy} onClick={applyOnCareersPage}>
                  {busy ? <span className="spin" /> : null} {app.session_id ? 'Apply again' : 'Apply'}
                </button>
              ) : null}
              {app.session_id && (
                <button className={`btn ${app.status === 'review' ? 'primary' : ''}`} onClick={() => navigate(`/apply/${app.session_id}`)}>
                  {app.status === 'review' ? 'Finish in the form review' : 'See the form and screenshots'}
                </button>
              )}
              <a className="btn ghost" href={app.apply_url} target="_blank" rel="noreferrer">Open it yourself ↗</a>
            </div>
          </div>
        )}

        <div className="card">
          <h3>
            <ListIcon style={{ width: 18, height: 18 }} /> Original message
          </h3>
          <div className={`raw-text ${rawLong && !rawOpen ? 'clamped' : ''}`}>
            {app.raw_text}
          </div>
          {rawLong && (
            <button
              className="btn sm"
              style={{ marginTop: 10 }}
              onClick={() => setRawOpen((v) => !v)}
            >
              {rawOpen ? 'Show less' : 'Show full message'}
            </button>
          )}
        </div>

        <div className="card">
          <h3>
            <GearIcon style={{ width: 18, height: 18 }} /> Details
          </h3>
          <div className="stack">
            <div className="grid-2">
              <Field label="Job title" value={app.job_title} onChange={setField('job_title')} />
              <Field label="Company" value={app.company} onChange={setField('company')} />
              <Field label="Location" value={app.location} onChange={setField('location')} />
              <Field
                label="Experience"
                value={app.experience}
                onChange={setField('experience')}
              />
            </div>
            <div className="grid-2">
              <label className="field">
                <span className="lbl">Apply via</span>
                <select
                  value={app.method}
                  onChange={(e) =>
                    setField('method')(e.target.value as Application['method'])
                  }
                >
                  <option value="email">Email</option>
                  <option value="gform">Google Form</option>
                  <option value="link">Careers page (filled for you)</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              {app.method === 'gform' ? (
                <Field label="Form URL" value={app.form_url} onChange={setField('form_url')} />
              ) : app.method === 'link' ? (
                <Field
                  label="Application URL"
                  value={app.apply_url}
                  onChange={setField('apply_url')}
                />
              ) : (
                <Field label="HR email" value={app.email_to} onChange={setField('email_to')} />
              )}
            </div>
            <Field
              label="Notes"
              value={app.notes}
              onChange={setField('notes')}
              placeholder="Private notes…"
            />
            <div>
              <button className="btn sm" onClick={saveParsed}>
                Save details
              </button>
            </div>
          </div>
        </div>

        {hasEmail && emailDraft && (
          <div className="card">
            <h3>
              <MailIcon style={{ width: 18, height: 18 }} /> Email application
            </h3>
            <div className="stack">
              {emails.length > 1 && (
                <label className="field">
                  <span className="lbl">
                    Send to (this post lists {emails.length} addresses)
                  </span>
                  <select
                    value={emailDraft.to || ''}
                    onChange={(e) => editDraft({ to: e.target.value })}
                  >
                    {emails.map((em) => (
                      <option key={em} value={em}>
                        {em}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Field label="To" value={emailDraft.to} onChange={(v) => editDraft({ to: v })} />
              <Field
                label="Subject"
                value={emailDraft.subject}
                onChange={(v) => editDraft({ subject: v })}
              />
              <label className="field">
                <span className="lbl">Body</span>
                <textarea
                  rows={12}
                  value={emailDraft.body}
                  onChange={(e) => editDraft({ body: e.target.value })}
                />
              </label>
              <p className="muted" style={{ fontSize: 12 }}>
                {emailDraft.attachment
                  ? `📎 Resume will be attached: ${emailDraft.attachment}`
                  : '⚠ No resume path set in Settings → Profile; email goes without attachment.'}
              </p>
              <div className="row-actions" style={{ marginTop: 0 }}>
                <button
                  className="btn success"
                  disabled={busy || applied || !emailDraft.to}
                  onClick={sendEmail}
                >
                  {busy ? 'Sending…' : applied ? 'Already applied' : '✉ Send application'}
                </button>
                {emailEdited && !applied && (
                  <button
                    className="btn sm"
                    title="Discard edits and rebuild from your template"
                    onClick={() =>
                      api.emailPreview(id).then((d) => {
                        setEmailDraft(d)
                        setEmailEdited(false)
                      })
                    }
                  >
                    ↻ Reset to template
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {hasForm && (
          <div className="card">
            <h3>
              <FormIcon style={{ width: 18, height: 18 }} /> Google Form application
            </h3>
            {!formData ? (
              formError ? (
                <div className="stack">
                  <p className="muted" style={{ fontSize: 13 }}>
                    This form needs a Google account. Apply fills it in the background — no window opens — signed in
                    to your account: answers from your profile, saved answers and the AI, the right file in each upload
                    question, then submits. Anything it can’t answer appears here for you.
                  </p>
                  <GoogleSignIn />
                  {app.status === 'applying' && (
                    <div className="ok-box"><span className="spin" /> {app.status_reason || 'Filling the form…'}</div>
                  )}
                  {app.status_reason && app.status !== 'applying' && !applied && (
                    <div className="warn-box">{app.status_reason}</div>
                  )}
                  <div className="row-actions" style={{ marginTop: 0 }}>
                    {!applied && app.status !== 'applying' && (
                      <button className="btn primary" disabled={busy} onClick={applyOnCareersPage}>
                        {busy ? <span className="spin" /> : null} Apply with my Google account
                      </button>
                    )}
                    <button className="btn" onClick={() => api.showFormWindow(app.id).catch((e) => toast((e as Error).message, 'error'))}>
                      Show the form
                    </button>
                    {!applied && (
                      <button className="btn ghost" onClick={() => window.confirm('Mark this post as applied? Do this only if you submitted the form yourself.') && setStatus('applied')}>
                        I submitted it myself
                      </button>
                    )}
                    {app.form_url && (
                      <a className="btn ghost" href={app.form_url} target="_blank" rel="noreferrer">Open in my browser ↗</a>
                    )}
                  </div>
                  {app.form_schema?.signed_in && (
                    <button className="link-btn small" disabled={formLoading} onClick={() => loadForm()}>
                      Show the questions it read, to answer the ones it couldn’t
                    </button>
                  )}
                </div>
              ) : (
                <div className="row-actions" style={{ marginTop: 0 }}>
                  <button
                    className="btn primary"
                    disabled={formLoading || !app.form_url}
                    onClick={() => loadForm()}
                  >
                    {formLoading ? 'Fetching form…' : 'Load form & auto-fill'}
                  </button>
                  {app.form_url && (
                    <a
                      className="btn"
                      href={app.form_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open form ↗
                    </a>
                  )}
                </div>
              )
            ) : (
              <div className="stack">
                <p>
                  <strong>{formData.form.title}</strong>
                </p>
                <div className="seg" style={{ maxWidth: 300 }}>
                  <button
                    className={formMode === 'embed' ? 'on' : ''}
                    onClick={() => setFormMode('embed')}
                  >
                    Fill in app
                  </button>
                  <button
                    className={formMode === 'fields' ? 'on' : ''}
                    onClick={() => setFormMode('fields')}
                  >
                    Auto-submit
                  </button>
                </div>
                {formMode === 'embed' && (
                  <div className="stack">
                    <p className="muted" style={{ fontSize: 12.5 }}>
                      The form is loaded here{' '}
                      <strong>pre-filled from your profile</strong>. Review it, complete
                      anything blank, and hit Submit inside the form.
                    </p>
                    <iframe
                      title="Google Form"
                      className="form-embed"
                      src={buildEmbedUrl(app, formData)}
                    />
                    <div className="row-actions" style={{ marginTop: 0 }}>
                      <a
                        className="btn"
                        href={app.form_url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in new tab ↗
                      </a>
                      {!applied && (
                        <button className="btn success" onClick={() => setStatus('applied')}>
                          Mark applied
                        </button>
                      )}
                    </div>
                    <Bookmarklet />
                  </div>
                )}
                {formMode === 'fields' && (
                  <div className="stack">
                    {!applied && (
                      <AiFillBar
                        appId={id}
                        answers={formData.answers}
                        missing={missingKeys.size}
                        aiCount={Object.values(formData.form.answer_meta ?? {}).filter((m) => m.source === 'ai').length}
                        disabled={app.status === 'applying'}
                        onDone={reloadAfterAi}
                      />
                    )}
                    {missingKeys.size > 0 ? (
                      <p className="warn-text">
                        ✎ {missingKeys.size} required question
                        {missingKeys.size > 1 ? 's' : ''} still need
                        {missingKeys.size > 1 ? '' : 's'} your answer. Fill the highlighted
                        {missingKeys.size > 1 ? ' ones' : ' one'} and press Apply — your answers are
                        remembered and reused on later forms.
                      </p>
                    ) : (
                      <p className="success-text">
                        ✓ Everything required has an answer. Each answer shows where it came from — check
                        the ones marked “AI”, then apply.
                      </p>
                    )}
                    {formData.form.collects_email && (
                      <div
                        className={`question ${missingKeys.has('emailAddress') ? 'missing' : ''}`}
                      >
                        <div className="q-title">
                          Your email (collected by form) <span className="q-req">*</span>
                        </div>
                        <input
                          value={String(formData.answers.emailAddress || '')}
                          onChange={(e) => setAnswer('emailAddress', e.target.value)}
                        />
                      </div>
                    )}
                    {formData.form.fields.map((f) => {
                      const key = `entry.${f.entry_id}`
                      const val = formData.answers[key]
                      return (
                        <div
                          key={key}
                          className={`question ${f.supported || f.type === 'file_upload' ? '' : 'unsupported'} ${missingKeys.has(key) ? 'missing' : ''}`}
                        >
                          <div className="q-title">
                            {f.title} {f.required && <span className="q-req">*</span>}
                            <AnswerSource meta={formData.form.answer_meta?.[key]} empty={isEmptyAns(val)} />
                          </div>
                          {f.description && <div className="q-meta">{f.description}</div>}
                          {missingKeys.has(key) && formData.form.missing_notes?.[key] && (
                            <div className="q-meta" style={{ color: 'var(--amber)' }}>{formData.form.missing_notes[key]}</div>
                          )}
                          {f.type === 'file_upload' &&
                            (files ? (
                              <FormFileChoice appId={id} entry={key} view={files} onChange={setFiles} disabled={applied || app.status === 'applying'} />
                            ) : (
                              <div className="q-meta">Loading your files…</div>
                            ))}
                          {!f.supported && f.type !== 'file_upload' && (
                            <div className="error-text">Unsupported question type ({f.type}). Submit this form manually.</div>
                          )}
                          {f.supported &&
                            (f.type === 'short_answer' || f.type === 'paragraph') &&
                            (f.type === 'paragraph' ? (
                              <textarea
                                rows={4}
                                value={String(val || '')}
                                onChange={(e) => setAnswer(key, e.target.value)}
                              />
                            ) : (
                              <input
                                value={String(val || '')}
                                onChange={(e) => setAnswer(key, e.target.value)}
                              />
                            ))}
                          {f.supported &&
                            (f.type === 'multiple_choice' ||
                              f.type === 'dropdown' ||
                              f.type === 'linear_scale') && (
                              <select
                                value={String(val || '')}
                                onChange={(e) => setAnswer(key, e.target.value)}
                              >
                                <option value="">— select —</option>
                                {f.options.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
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
                                      onChange={(e) =>
                                        setAnswer(
                                          key,
                                          e.target.checked
                                            ? [...arr, o]
                                            : arr.filter((x) => x !== o),
                                        )
                                      }
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
                              value={
                                val && typeof val === 'object' && !Array.isArray(val)
                                  ? `${val.year}-${String(val.month).padStart(2, '0')}-${String(val.day).padStart(2, '0')}`
                                  : ''
                              }
                              onChange={(e) => {
                                const [y, m, d] = e.target.value.split('-')
                                setAnswer(
                                  key,
                                  y
                                    ? { year: y, month: String(+m), day: String(+d) }
                                    : '',
                                )
                              }}
                            />
                          )}
                        </div>
                      )
                    })}
                    <div className="row-actions" style={{ marginTop: 0 }}>
                      <button
                        className="btn success"
                        disabled={busy || applied || app.status === 'applying'}
                        onClick={submitForm}
                      >
                        {app.status === 'applying' ? <><span className="spin" /> Applying…</> : busy ? 'Sending…' : applied ? 'Already applied' : '✓ Apply with these answers'}
                      </button>
                      <button className="btn" onClick={() => api.showFormWindow(app.id).then(() => toast('Opening the form with your answers filled in…', 'info')).catch((e) => toast((e as Error).message, 'error'))}>
                        Show the form
                      </button>
                      {!applied && (
                        <button className="btn ghost" onClick={() => window.confirm('Mark this post as applied? Do this only if you submitted the form yourself.') && setStatus('applied')}>
                          I submitted it myself
                        </button>
                      )}
                      <button
                        className="btn ghost"
                        onClick={() => loadForm()}
                        disabled={formLoading}
                      >
                        ↻ Re-read the form
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {hasLink && (
          <div className="card">
            <h3>
              <LinkIcon style={{ width: 18, height: 18 }} /> Apply on an external page
            </h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              {links.length > 1 ? 'These links were' : 'This link was'} found in the post
              (company careers page / Workday / Microsoft Forms). They can’t be auto-filled
              — open, apply there, then mark it applied here. Use the copy panel below to
              fill fields fast.
            </p>
            <div className="link-list">
              {links.map((u) => (
                <div key={u} className="link-row">
                  <a
                    className="btn sm primary"
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open ↗
                  </a>
                  <span className="link-url">{u}</span>
                </div>
              ))}
            </div>
            <div className="row-actions" style={{ marginTop: 12 }}>
              {!applied && (
                <button className="btn success" onClick={() => setStatus('applied')}>
                  Mark applied
                </button>
              )}
            </div>
            <QuickFill />
          </div>
        )}

        <div className="card">
          <h3>
            <GearIcon style={{ width: 18, height: 18 }} /> Actions
          </h3>
          <div className="row-actions" style={{ marginTop: 0 }}>
            {!applied && (
              <button className="btn" onClick={() => setStatus('applied')}>
                Mark applied manually
              </button>
            )}
            {app.status !== 'skipped' && (
              <button className="btn" onClick={() => setStatus('skipped')}>
                Skip
              </button>
            )}
            {(app.status === 'skipped' || app.status === 'failed') && (
              <button className="btn" onClick={() => setStatus('review')}>
                Back to review
              </button>
            )}
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  you: 'You',
  profile: 'Profile',
  answers: 'Your settings',
  learned: 'Saved answer',
  ai: 'AI-generated',
}

/** Where an answer came from — so you know which ones to check. */
function AnswerSource({ meta, empty }: { meta?: FormAnswerMeta; empty: boolean }) {
  if (!meta || empty) return null
  const judged = meta.source === 'ai' && meta.basis === 'inferred'
  const title = meta.source === 'ai'
    ? meta.basis === 'fact' ? 'Taken from your resume or profile by the AI' : meta.basis === 'preference' ? 'From your preferences' : 'The AI’s judgement — check it'
    : meta.note || undefined
  const label = meta.source === 'you' && meta.note === 'edited' ? 'AI-generated · edited by you' : SOURCE_LABEL[meta.source] ?? meta.source
  return (
    <span className={`pill ${meta.source === 'you' ? 'ok' : judged ? 'warn' : 'info'}`} style={{ marginLeft: 8, fontSize: 11, verticalAlign: 'middle' }} title={title}>
      {label}{judged ? ' — check' : ''}
    </span>
  )
}
