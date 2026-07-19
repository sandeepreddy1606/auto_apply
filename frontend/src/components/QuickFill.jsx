import { useEffect, useState } from 'react'
import { api } from '../api'
import { useToast } from '../Toast'

// Fields most application forms ask for, in a sensible order.
const FIELDS = [
  ['full_name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'],
  ['current_location', 'Current location'], ['preferred_location', 'Preferred location'],
  ['experience_years', 'Experience'], ['current_company', 'Current company'],
  ['current_role', 'Current role'], ['notice_period', 'Notice period'],
  ['current_ctc', 'Current CTC'], ['expected_ctc', 'Expected CTC'],
  ['skills', 'Skills'], ['degree', 'Degree'], ['college', 'College'],
  ['graduation_year', 'Graduation year'], ['linkedin', 'LinkedIn'],
  ['github', 'GitHub'], ['portfolio', 'Portfolio'], ['resume_url', 'Resume link'],
]

export default function QuickFill() {
  const [profile, setProfile] = useState(null)
  const [copied, setCopied] = useState(null)
  const toast = useToast()

  useEffect(() => {
    api.getSettings().then((s) => setProfile(s.profile || {})).catch(() => setProfile({}))
  }, [])

  if (!profile) return null

  const rows = FIELDS.filter(([k]) => String(profile[k] || '').trim())
  if (rows.length === 0) {
    return <p className="muted" style={{ fontSize: 12.5 }}>Fill your profile in Settings to get quick-copy values here.</p>
  }

  const copy = async (key, value) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      toast('Copy failed — select the text manually.', 'error')
    }
  }

  return (
    <div className="quickfill">
      <div className="qf-head">Your details — tap to copy while filling the form</div>
      {rows.map(([key, label]) => (
        <button key={key} className="qf-row" onClick={() => copy(key, String(profile[key]))} title="Copy">
          <span className="qf-label">{label}</span>
          <span className="qf-value">{String(profile[key])}</span>
          <span className="qf-copy">{copied === key ? '✓ copied' : 'copy'}</span>
        </button>
      ))}
    </div>
  )
}
