import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useToast } from '../../Toast'
import { navigate, setNavGuard } from '../../router'
import { EyeIcon, EyeOffIcon } from '../../components/Icons'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const URL_RE = /^https?:\/\/\S+\.\S+/i
export const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/
export const TG_PHONE_RE = /^\+\d{7,15}$/

export const PROFILE_FIELDS = [
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

export const CORE_FIELDS = ['full_name', 'email', 'phone', 'current_location',
  'experience_years', 'notice_period', 'skills']

export const KNOWN_PLACEHOLDERS = new Set([
  ...PROFILE_FIELDS.map(([k]) => k), 'cover_note',
  'job_title', 'company', 'location', 'experience',
])

// Mirror of the backend renderer, for the live template preview.
export function renderTemplate(tpl, ctx) {
  let out = (tpl || '').replace(/\{([a-z_]+)\}/g, (_, k) => String(ctx[k] ?? ''))
  out = out.split('\n')
    .filter((line) => !/^\s*[-•]?\s*[A-Za-z ]{2,30}:\s*$/.test(line))
    .join('\n')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function profileCompleteness(profile) {
  const filled = PROFILE_FIELDS.filter(([k]) => String(profile?.[k] || '').trim()).length
  return { filled, total: PROFILE_FIELDS.length }
}

export function validateProfile(p) {
  const errs = {}
  if (p.email && !EMAIL_RE.test(p.email.trim())) errs.email = 'Doesn’t look like a valid email'
  if (p.phone && !PHONE_RE.test(p.phone.trim())) errs.phone = 'Doesn’t look like a valid phone number'
  for (const k of ['linkedin', 'github', 'portfolio', 'resume_url']) {
    if (p[k] && !URL_RE.test(p[k].trim())) errs[k] = 'Must be a full URL starting with http(s)://'
  }
  if (p.graduation_year) {
    const y = Number(p.graduation_year)
    if (!/^\d{4}$/.test(String(p.graduation_year).trim()) || y < 1950 || y > 2049) {
      errs.graduation_year = 'Enter a 4-digit year'
    }
  }
  if (p.date_of_birth) {
    const v = String(p.date_of_birth).trim()
    const d = new Date(v)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d > new Date()) {
      errs.date_of_birth = 'Use YYYY-MM-DD (a past date)'
    }
  }
  return errs
}

export function validateSmtp(m) {
  const errs = {}
  if (m.username && !EMAIL_RE.test(m.username.trim())) {
    errs.username = 'Should be the full email address you log in with'
  }
  if (m.port !== '' && m.port != null) {
    const port = Number(String(m.port).trim())
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errs.port = 'Port must be a number between 1 and 65535'
    }
  }
  return errs
}

export function validateTelegram(t) {
  const errs = {}
  if (t.api_id && !/^\d+$/.test(String(t.api_id).trim())) errs.api_id = 'API ID is numbers only'
  if (t.phone && !TG_PHONE_RE.test(String(t.phone).replace(/[\s-]/g, ''))) {
    errs.phone = 'Use international format, e.g. +919876543210'
  }
  return errs
}

export function Input({ label, value, onChange, type = 'text', placeholder, error }) {
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

/* One settings section per page: loads the full settings (for cross-section
   context), edits one section, saves just that section, tracks dirty state. */
export function useSection(sectionName, validate) {
  const [data, setData] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [full, setFull] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const load = useCallback(() => {
    setLoadError(null)
    api.getSettings().then((s) => {
      setFull(s)
      setData(s[sectionName])
      setBaseline(s[sectionName])
    }).catch((e) => setLoadError(e.message))
  }, [sectionName])
  useEffect(load, [load])

  const dirty = useMemo(
    () => !!data && !!baseline && JSON.stringify(data) !== JSON.stringify(baseline),
    [data, baseline],
  )
  const errors = useMemo(() => (data && validate ? validate(data) : {}), [data, validate])
  const errorCount = Object.keys(errors).length

  // Guard EVERY in-app navigation (bottom nav, links, back button) plus real
  // tab/window close while there are unsaved edits.
  useEffect(() => {
    setNavGuard(() => dirty)
    if (!dirty) return () => setNavGuard(null)
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => {
      setNavGuard(null)
      window.removeEventListener('beforeunload', handler)
    }
  }, [dirty])

  const set = (key) => (value) => setData((d) => ({ ...d, [key]: value }))

  const save = async () => {
    if (errorCount > 0) {
      toast(`Fix ${errorCount} highlighted field${errorCount > 1 ? 's' : ''} before saving.`, 'error')
      setTimeout(() => {
        document.querySelector('.field.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 60)
      return false
    }
    setSaving(true)
    try {
      const saved = await api.saveSettings({ [sectionName]: data })
      setFull(saved)
      setData(saved[sectionName])
      setBaseline(saved[sectionName])
      toast('Saved.', 'success')
      return true
    } catch (e) {
      toast(e.message, 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  const discard = () => setData(baseline)

  // For flows that persist outside save() (e.g. Telegram connect).
  const markSaved = (section) => { setData(section); setBaseline(section) }

  // For single keys persisted immediately (e.g. watched chats): update the key
  // in both data and baseline WITHOUT touching other unsaved edits.
  const markKeySaved = (key, value) => {
    setData((d) => ({ ...d, [key]: value }))
    setBaseline((b) => (b ? { ...b, [key]: value } : b))
  }

  return { data, setData, set, full, dirty, errors, errorCount, saving,
           save, discard, load, loadError, markSaved, markKeySaved }
}

/* Back handler — navigate() itself now consults the global unsaved-edits
   guard, so this just navigates (dirty param kept for call-site clarity). */
export function useGuardedBack(_dirty, to = '/settings') {
  return () => navigate(to)
}

export function LoadError({ message, onRetry }) {
  return (
    <div className="card">
      <p className="error-text">Couldn’t load settings: {message}</p>
      <div className="row-actions">
        <button className="btn primary" onClick={onRetry}>Retry</button>
      </div>
    </div>
  )
}

export function SaveBar({ dirty, saving, errorCount, onSave, onDiscard }) {
  if (!dirty) return null
  return (
    <div className="save-bar">
      <span>{errorCount > 0 ? `${errorCount} field${errorCount > 1 ? 's' : ''} need attention` : 'Unsaved changes'}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn sm" onClick={onDiscard}>Discard</button>
        <button className="btn sm primary" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
