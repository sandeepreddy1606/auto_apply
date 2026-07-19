import { useState } from 'react'
import { api } from '../../api'
import { useToast } from '../../Toast'
import PageHeader from '../../components/PageHeader'
import {
  Input, useSection, useGuardedBack, SaveBar, LoadError,
  PROFILE_FIELDS, CORE_FIELDS, validateProfile,
} from './shared'

export default function ProfilePage() {
  const s = useSection('profile', validateProfile)
  const back = useGuardedBack(s.dirty)
  const [resumeCheck, setResumeCheck] = useState(null)
  const toast = useToast()

  if (s.loadError) return <><PageHeader title="Profile" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>
  if (!s.data) return <><PageHeader title="Profile" backTo="/settings" /><p className="muted">Loading…</p></>

  const p = s.data
  const filled = PROFILE_FIELDS.filter(([k]) => String(p[k] || '').trim()).length
  const missingCore = CORE_FIELDS.filter((k) => !String(p[k] || '').trim())
  const completeness = Math.round((filled / PROFILE_FIELDS.length) * 100)

  const verifyResume = async () => {
    const path = (p.resume_path || '').trim()
    if (!path) { toast('Enter a resume file path first.', 'error'); return }
    try {
      const res = await api.checkResume(path)
      setResumeCheck(res)
      if (!res.exists) toast('File not found at that path.', 'error')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <>
      <PageHeader title="Profile" sub="Fills job application forms and emails" onBack={back} />

      <div className="settings-stack">
        <div className="card">
          <div className="meter-row">
            <div className="meter"><div className="meter-fill" style={{ width: `${completeness}%` }} /></div>
            <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
              {filled}/{PROFILE_FIELDS.length} filled
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
                  <select value={p[key] || ''} onChange={(e) => s.set(key)(e.target.value)}>
                    <option value="">—</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </label>
              ) : (
                <Input key={key} label={label} value={p[key]}
                  onChange={s.set(key)} error={s.errors[key]} />
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
              <textarea rows={3} value={p.cover_note || ''}
                onChange={(e) => s.set('cover_note')(e.target.value)} />
            </label>
          </div>
        </div>

        <button className="btn primary" style={{ padding: '15px', fontSize: 15 }}
          disabled={s.saving || !s.dirty} onClick={s.save}>
          {s.saving ? 'Saving…' : s.dirty ? 'Save profile' : 'All changes saved'}
        </button>
      </div>

      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount}
        onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
