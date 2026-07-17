import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useToast } from '../Toast'
import { SendIcon, MailIcon, GearIcon, ListIcon, EyeIcon, EyeOffIcon } from '../components/Icons'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL_RE = /^https?:\/\/\S+\.\S+/i
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/
const TG_PHONE_RE = /^\+\d{7,15}$/

function Input({ label, value, onChange, type = 'text', placeholder, error }) {
  const [show, setShow] = useState(false)
  const isPw = type === 'password'
  return (
    <label className={`field ${error ? 'invalid' : ''}`}>
      <span className="lbl">{label}</span>
      <div className="input-wrap">
        <input
          type={isPw && !show ? 'password' : 'text'}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {isPw && (
          <button type="button" className="eye-btn" tabIndex={-1}
            title={show ? 'Hide' : 'Show'} onClick={() => setShow((s) => !s)}>
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {error && <span className="field-err">{error}</span>}
    </label>
  )
}

const PROFILE_FIELDS = [
  ['full_name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'],
  ['current_location', 'Current location'], ['preferred_location', 'Preferred location'],
  ['experience_years', 'Experience (e.g. 3 years)'], ['current_company', 'Current company'],
  ['current_role', 'Current role'], ['notice_period', 'Notice period'],
  ['current_ctc', 'Current CTC'], ['expected_ctc', 'Expected CTC'],
  ['skills', 'Skills (comma separated)'], ['degree', 'Degree'],
  ['college', 'College'], ['graduation_year', 'Graduation year'],
  ['gender', 'Gender'], ['date_of_birth', 'Date of birth (YYYY-MM-DD)'],
  ['willing_to_relocate', 'Willing to relocate'],
  ['linkedin', 'LinkedIn URL'], ['github', 'GitHub URL'], ['portfolio', 'Portfolio URL'],
  ['resume_url', 'Resume link (Drive/URL, used in forms)'],
  ['resume_path', 'Resume file path (attached to emails)'],
]

// Fields the auto-fill / email engine really needs to do its job.
const CORE_FIELDS = ['full_name', 'email', 'phone', 'current_location',
  'experience_years', 'notice_period', 'skills']

const KNOWN_PLACEHOLDERS = new Set([
  ...PROFILE_FIELDS.map(([k]) => k), 'cover_note',
  'job_title', 'company', 'location', 'experience',
])

const SECTIONS = [
  ['telegram', 'Telegram'], ['profile', 'Profile'], ['email', 'Email'],
  ['template', 'Template'], ['automation', 'Automation'],
]

function validate(s) {
  const errs = {}
  const p = s.profile, m = s.smtp, t = s.telegram
  const bad = (key, msg) => { errs[key] = msg }

  if (p.email && !EMAIL_RE.test(p.email.trim())) bad('profile.email', 'Doesn’t look like a valid email')
  if (p.phone && !PHONE_RE.test(p.phone.trim())) bad('profile.phone', 'Doesn’t look like a valid phone number')
  for (const k of ['linkedin', 'github', 'portfolio', 'resume_url']) {
    if (p[k] && !URL_RE.test(p[k].trim())) bad(`profile.${k}`, 'Must be a full URL starting with http(s)://')
  }
  if (p.graduation_year) {
    const y = Number(p.graduation_year)
    if (!/^\d{4}$/.test(String(p.graduation_year).trim()) || y < 1950 || y > 2049) {
      bad('profile.graduation_year', 'Enter a 4-digit year')
    }
  }
  if (p.date_of_birth) {
    const v = String(p.date_of_birth).trim()
    const d = new Date(v)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d > new Date()) {
      bad('profile.date_of_birth', 'Use YYYY-MM-DD (a past date)')
    }
  }

  if (m.username && !EMAIL_RE.test(m.username.trim())) bad('smtp.username', 'Should be the full email address you log in with')
  if (m.port !== '' && m.port != null) {
    const port = Number(String(m.port).trim())
    if (!Number.isInteger(port) || port < 1 || port > 65535) bad('smtp.port', 'Port must be a number between 1 and 65535')
  }

  if (t.api_id && !/^\d+$/.test(String(t.api_id).trim())) bad('telegram.api_id', 'API ID is numbers only')
  if (t.phone && !TG_PHONE_RE.test(String(t.phone).replace(/[\s-]/g, ''))) {
    bad('telegram.phone', 'Use international format, e.g. +919876543210')
  }
  return errs
}

// Mirror of the backend renderer, for the live preview.
function renderTemplate(tpl, ctx) {
  let out = (tpl || '').replace(/\{([a-z_]+)\}/g, (_, k) => String(ctx[k] ?? ''))
  out = out.split('\n')
    .filter((line) => !/^\s*[-•]?\s*[A-Za-z ]{2,30}:\s*$/.test(line))
    .join('\n')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export default function Settings({ tg, setTg }) {
  const [settings, setSettings] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [chats, setChats] = useState(null)
  const [chatQuery, setChatQuery] = useState('')
  const [tgBusy, setTgBusy] = useState(false)
  const [resumeCheck, setResumeCheck] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const toast = useToast()
  const sectionRefs = useRef({})

  const load = () => {
    setLoadError(null)
    api.getSettings()
      .then((s) => { setSettings(s); setBaseline(s) })
      .catch((e) => setLoadError(e.message))
  }
  useEffect(load, [])

  const dirty = useMemo(
    () => !!settings && !!baseline && JSON.stringify(settings) !== JSON.stringify(baseline),
    [settings, baseline],
  )

  // Warn before the tab/window closes with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const errors = useMemo(() => (settings ? validate(settings) : {}), [settings])
  const errorCount = Object.keys(errors).length

  if (loadError) {
    return (
      <div className="card">
        <p className="error-text">Couldn’t load settings: {loadError}</p>
        <div className="row-actions">
          <button className="btn primary" onClick={load}>Retry</button>
        </div>
      </div>
    )
  }
  if (!settings) return <p className="muted">Loading settings…</p>

  const set = (section, key) => (value) => {
    setSettings((s) => ({ ...s, [section]: { ...s[section], [key]: value } }))
    if (section === 'profile' && key === 'resume_path') setResumeCheck(null)
  }

  const scrollToFirstError = () => {
    setTimeout(() => {
      document.querySelector('.field.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
  }

  const save = async () => {
    if (errorCount > 0) {
      toast(`Fix ${errorCount} highlighted field${errorCount > 1 ? 's' : ''} before saving.`, 'error')
      scrollToFirstError()
      return
    }
    setSaving(true)
    try {
      const saved = await api.saveSettings(settings)
      setSettings(saved)
      setBaseline(saved)
      toast('Settings saved.', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setSettings(baseline)
    toast('Changes discarded.')
  }

  const smtpReady = !!(settings.smtp.host && settings.smtp.username && settings.smtp.password)

  const testEmail = async () => {
    const to = (testTo || settings.profile.email || '').trim()
    if (!to) { toast('Enter a recipient (or fill your profile email).', 'error'); return }
    if (!EMAIL_RE.test(to)) { toast('Recipient doesn’t look like a valid email.', 'error'); return }
    setTestBusy(true)
    try {
      const saved = await api.saveSettings(settings)
      setSettings(saved)
      setBaseline(saved)
      await api.testEmail(to)
      toast(`Test email sent to ${to} — check the inbox.`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTestBusy(false)
    }
  }

  const verifyResume = async () => {
    const path = (settings.profile.resume_path || '').trim()
    if (!path) { toast('Enter a resume file path first.', 'error'); return }
    try {
      const res = await api.checkResume(path)
      setResumeCheck(res)
      if (!res.exists) toast('File not found at that path.', 'error')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const resetTemplate = async () => {
    if (!window.confirm('Replace the subject and body with the default template?')) return
    try {
      const defaults = await api.getSettingsDefaults()
      setSettings((s) => ({ ...s, email_template: { ...defaults.email_template } }))
      toast('Template reset — remember to save.')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const setConnection = (useSsl) => {
    setSettings((s) => {
      const port = String(s.smtp.port).trim()
      const next = { ...s.smtp, use_ssl: useSsl }
      // Keep the port in step unless the user picked a custom one.
      if (useSsl && (port === '587' || port === '')) next.port = 465
      if (!useSsl && (port === '465' || port === '')) next.port = 587
      return { ...s, smtp: next }
    })
  }

  const tgAction = async (fn) => {
    setTgBusy(true)
    try {
      await api.saveSettings({ telegram: settings.telegram })
      setBaseline((b) => b && { ...b, telegram: settings.telegram })
      const status = await fn()
      setTg(status)
      if (status.state === 'error') toast(status.error || 'Telegram error', 'error')
      if (status.state === 'connected') {
        toast('Telegram connected — listening for job posts.', 'success')
        setCode(''); setPassword('')
        loadChats()
      }
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTgBusy(false)
    }
  }

  const loadChats = async () => {
    try {
      setChats(await api.tgChats())
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const watched = settings.telegram.watched_chats || []
  const toggleChat = (chat) => {
    const exists = watched.some((c) => String(c.id) === String(chat.id))
    const next = exists ? watched.filter((c) => String(c.id) !== String(chat.id)) : [...watched, chat]
    setSettings((s) => ({ ...s, telegram: { ...s.telegram, watched_chats: next } }))
    // Persisted immediately below, so keep the dirty-baseline in sync too.
    setBaseline((b) => b && { ...b, telegram: { ...b.telegram, watched_chats: next } })
    api.tgWatch(next).catch((e) => toast(e.message, 'error'))
  }
  const visibleChats = (chats || []).filter(
    (c) => !chatQuery || (c.title || '').toLowerCase().includes(chatQuery.toLowerCase()),
  )

  const filledCount = PROFILE_FIELDS.filter(([k]) => String(settings.profile[k] || '').trim()).length
  const missingCore = CORE_FIELDS.filter((k) => !String(settings.profile[k] || '').trim())
  const completeness = Math.round((filledCount / PROFILE_FIELDS.length) * 100)

  const tplText = `${settings.email_template.subject || ''}\n${settings.email_template.body || ''}`
  const unknownPlaceholders = [...new Set(
    [...tplText.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k) => !KNOWN_PLACEHOLDERS.has(k)),
  )]
  const previewCtx = {
    ...settings.profile,
    job_title: 'Frontend Developer', company: 'Acme Corp',
    location: 'Hyderabad', experience: '3+ years',
  }

  const scrollTo = (id) => sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const sectionRef = (id) => (el) => { sectionRefs.current[id] = el }

  return (
    <div className="settings-stack">
      <div className="settings-nav chips">
        {SECTIONS.map(([id, label]) => (
          <button key={id} className="chip" onClick={() => scrollTo(id)}>{label}</button>
        ))}
      </div>

      <div className="card" ref={sectionRef('telegram')}>
        <h3><SendIcon style={{ width: 18, height: 18 }} /> Telegram — message source</h3>
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
          Connects with <strong>your own account</strong>, so posts from private channels
          you're a member of arrive automatically — no pasting, no bot required. Get{' '}
          <strong>api_id</strong> / <strong>api_hash</strong> from{' '}
          <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a>
          {' '}→ API development tools.
        </p>
        <div className="grid-2">
          <Input label="API ID" value={settings.telegram.api_id} onChange={set('telegram', 'api_id')}
            error={errors['telegram.api_id']} />
          <Input label="API hash" type="password" value={settings.telegram.api_hash} onChange={set('telegram', 'api_hash')} />
          <Input label="Phone (+91…)" value={settings.telegram.phone} onChange={set('telegram', 'phone')}
            error={errors['telegram.phone']} />
        </div>

        <div className="row-actions">
          {tg.state !== 'connected' && (
            <button className="btn primary" disabled={tgBusy} onClick={() => tgAction(api.tgConnect)}>
              {tgBusy ? 'Working…' : 'Connect Telegram'}
            </button>
          )}
          {tg.state === 'connected' && (
            <>
              <span className="success-text">● Connected — listening</span>
              <button className="btn sm" onClick={loadChats}>{chats ? 'Refresh channels' : 'Load my channels'}</button>
              <button className="btn sm danger" disabled={tgBusy} onClick={() => tgAction(api.tgDisconnect)}>Disconnect</button>
            </>
          )}
        </div>

        {tg.state === 'awaiting_code' && (
          <div className="row-actions">
            <input style={{ maxWidth: 200 }} placeholder="Login code from Telegram" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn primary" disabled={tgBusy || !code.trim()} onClick={() => tgAction(() => api.tgCode(code.trim()))}>Verify</button>
          </div>
        )}
        {tg.state === 'awaiting_password' && (
          <div className="row-actions">
            <input style={{ maxWidth: 200 }} type="password" placeholder="2FA password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn primary" disabled={tgBusy || !password} onClick={() => tgAction(() => api.tgPassword(password))}>Verify</button>
          </div>
        )}
        {tg.state === 'error' && tg.error && <p className="error-text" style={{ marginTop: 12 }}>⚠ {tg.error}</p>}

        {tg.state === 'connected' && watched.length === 0 && (
          <p className="warn-text" style={{ marginTop: 12 }}>
            No channels are being watched yet — load your channels and tick the ones with job posts.
          </p>
        )}
        {watched.length > 0 && (
          <p style={{ marginTop: 14, fontSize: 13 }} className="muted">
            Watching {watched.length}: <span style={{ color: 'var(--text)' }}>{watched.map((c) => c.title).join(', ')}</span>
          </p>
        )}
        {chats && (
          <>
            {chats.length > 6 && (
              <div className="search-wrap" style={{ marginTop: 12 }}>
                <input placeholder={`Search ${chats.length} channels…`} value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)} />
              </div>
            )}
            <div className="chat-list">
              {visibleChats.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No channels match.</p>}
              {visibleChats.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={watched.some((w) => String(w.id) === String(c.id))}
                    onChange={() => toggleChat(c)}
                  />
                  {c.title}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card" ref={sectionRef('profile')}>
        <h3><ListIcon style={{ width: 18, height: 18 }} /> Profile — fills forms & emails</h3>
        <div className="meter-row">
          <div className="meter"><div className="meter-fill" style={{ width: `${completeness}%` }} /></div>
          <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
            {filledCount}/{PROFILE_FIELDS.length} filled
          </span>
        </div>
        {missingCore.length > 0 && (
          <p className="warn-text" style={{ marginBottom: 12 }}>
            Needed for auto-fill: {missingCore.map((k) => PROFILE_FIELDS.find(([f]) => f === k)[1].split(' (')[0]).join(', ')}
          </p>
        )}
        <div className="grid-2">
          {PROFILE_FIELDS.map(([key, label]) => (
            key === 'willing_to_relocate' ? (
              <label key={key} className="field">
                <span className="lbl">{label}</span>
                <select value={settings.profile[key] || ''} onChange={(e) => set('profile', key)(e.target.value)}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </label>
            ) : (
              <Input key={key} label={label} value={settings.profile[key]}
                onChange={set('profile', key)} error={errors[`profile.${key}`]} />
            )
          ))}
        </div>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <button className="btn sm" onClick={verifyResume}>Verify resume file</button>
          {resumeCheck && (resumeCheck.exists
            ? <span className="success-text">✓ {resumeCheck.filename} ({resumeCheck.size_kb} KB)</span>
            : <span className="error-text">File not found — check the path</span>)}
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="field">
            <span className="lbl">Cover note (for "tell us about yourself" questions)</span>
            <textarea rows={3} value={settings.profile.cover_note || ''}
              onChange={(e) => set('profile', 'cover_note')(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card" ref={sectionRef('email')}>
        <h3><MailIcon style={{ width: 18, height: 18 }} /> Email sending (SMTP)</h3>
        <div className="grid-2">
          <Input label="SMTP host" value={settings.smtp.host} onChange={set('smtp', 'host')} />
          <Input label="Port" value={settings.smtp.port} onChange={set('smtp', 'port')} error={errors['smtp.port']} />
          <Input label="From name" value={settings.smtp.from_name} onChange={set('smtp', 'from_name')} />
          <Input label="Username (email)" value={settings.smtp.username} onChange={set('smtp', 'username')}
            error={errors['smtp.username']} />
          <Input label="Password / app password" type="password" value={settings.smtp.password} onChange={set('smtp', 'password')} />
          <label className="field">
            <span className="lbl">Connection</span>
            <select value={settings.smtp.use_ssl ? '1' : '0'} onChange={(e) => setConnection(e.target.value === '1')}>
              <option value="0">STARTTLS (port 587)</option>
              <option value="1">SSL (port 465)</option>
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: '12px 0', fontSize: 12.5 }}>
          Gmail: enable 2-step verification, create an <strong>App password</strong>, use it here.
        </p>
        <div className="row-actions" style={{ marginTop: 4 }}>
          <input style={{ maxWidth: 250 }} placeholder="Send test to… (default: your email)"
            value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn sm" disabled={!smtpReady || testBusy}
            title={smtpReady ? '' : 'Fill host, username and password first'} onClick={testEmail}>
            {testBusy ? 'Sending…' : 'Send test'}
          </button>
          {!smtpReady && <span className="muted" style={{ fontSize: 12 }}>Fill host, username & password to test</span>}
        </div>
      </div>

      <div className="card" ref={sectionRef('template')}>
        <h3><MailIcon style={{ width: 18, height: 18 }} /> Email template</h3>
        <div className="stack">
          <Input label="Subject template" value={settings.email_template.subject} onChange={set('email_template', 'subject')} />
          <label className="field">
            <span className="lbl">Body template</span>
            <textarea rows={12} value={settings.email_template.body}
              onChange={(e) => set('email_template', 'body')(e.target.value)} />
          </label>
          {unknownPlaceholders.length > 0 && (
            <p className="warn-text">
              Unknown placeholder{unknownPlaceholders.length > 1 ? 's' : ''} (will render empty):{' '}
              {unknownPlaceholders.map((k) => `{${k}}`).join(' ')}
            </p>
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            Placeholders: {'{job_title} {company} {full_name} {email} {phone} {experience_years} {skills} {current_location} {notice_period} {linkedin} {github} {portfolio}'} — empty lines are dropped automatically.
          </p>
          <div className="row-actions" style={{ marginTop: 0 }}>
            <button className="btn sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? 'Hide preview' : 'Preview with my profile'}
            </button>
            <button className="btn sm" onClick={resetTemplate}>Reset to default</button>
          </div>
          {showPreview && (
            <div className="preview-box">
              <div className="preview-subject">{renderTemplate(settings.email_template.subject, previewCtx) || '(empty subject)'}</div>
              <pre>{renderTemplate(settings.email_template.body, previewCtx) || '(empty body)'}</pre>
            </div>
          )}
        </div>
      </div>

      <div className="card" ref={sectionRef('automation')}>
        <h3><GearIcon style={{ width: 18, height: 18 }} /> Automation</h3>
        <div className="stack">
          <label className="toggle">
            <input type="checkbox" checked={!!settings.automation.auto_apply_email}
              onChange={(e) => set('automation', 'auto_apply_email')(e.target.checked)} />
            <span>Auto-send email applications for incoming posts (when HR email + role were detected)</span>
          </label>
          {settings.automation.auto_apply_email && !smtpReady && (
            <p className="warn-text">SMTP isn't configured yet — auto-emails will fail until host, username and password are set above.</p>
          )}
          {settings.automation.auto_apply_email && !String(settings.profile.resume_path || '').trim() && (
            <p className="warn-text">No resume file path set — auto-emails will go out without an attachment.</p>
          )}
          <label className="toggle">
            <input type="checkbox" checked={!!settings.automation.auto_apply_gform}
              onChange={(e) => set('automation', 'auto_apply_gform')(e.target.checked)} />
            <span>Auto-submit Google Forms (only when every required question could be auto-filled)</span>
          </label>
          {settings.automation.auto_apply_gform && missingCore.length > 0 && (
            <p className="warn-text">Your profile is missing key fields ({missingCore.length}) — most forms won't fully auto-fill until they're set.</p>
          )}
          <p className="muted" style={{ fontSize: 12.5 }}>
            Leave these off initially — review a few applications first.
          </p>
        </div>
      </div>

      <button className="btn primary" style={{ padding: '15px', fontSize: 15 }}
        disabled={saving || !dirty} onClick={save}>
        {saving ? 'Saving…' : dirty ? 'Save all settings' : 'All changes saved'}
      </button>

      {dirty && (
        <div className="save-bar">
          <span>{errorCount > 0 ? `${errorCount} field${errorCount > 1 ? 's' : ''} need attention` : 'Unsaved changes'}</span>
          <div className="row" style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" onClick={discard}>Discard</button>
            <button className="btn sm primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
