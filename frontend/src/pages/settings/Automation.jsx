import { navigate } from '../../router'
import PageHeader from '../../components/PageHeader'
import { useSection, useGuardedBack, SaveBar, LoadError, CORE_FIELDS } from './shared'

export default function AutomationPage() {
  const s = useSection('automation', null)
  const back = useGuardedBack(s.dirty)

  if (s.loadError) return <><PageHeader title="Automation" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>
  if (!s.data) return <><PageHeader title="Automation" backTo="/settings" /><p className="muted">Loading…</p></>

  const a = s.data
  const smtp = s.full?.smtp || {}
  const profile = s.full?.profile || {}
  const smtpReady = !!(smtp.host && smtp.username && smtp.password)
  const missingCore = CORE_FIELDS.filter((k) => !String(profile[k] || '').trim())

  return (
    <>
      <PageHeader title="Automation" sub="What happens when a new job post arrives" onBack={back} />

      <div className="settings-stack">
        <div className="card">
          <div className="stack">
            <label className="toggle">
              <input type="checkbox" checked={!!a.auto_apply_email}
                onChange={(e) => s.set('auto_apply_email')(e.target.checked)} />
              <span>Auto-send email applications for incoming posts (when HR email + role were detected)</span>
            </label>
            {a.auto_apply_email && !smtpReady && (
              <p className="warn-text">
                SMTP isn't configured yet — auto-emails will fail.{' '}
                <a onClick={() => navigate('/settings/email')} style={{ cursor: 'pointer' }}>Set it up →</a>
              </p>
            )}
            {a.auto_apply_email && !String(profile.resume_path || '').trim() && (
              <p className="warn-text">
                No resume file path set — auto-emails will go out without an attachment.{' '}
                <a onClick={() => navigate('/settings/profile')} style={{ cursor: 'pointer' }}>Add it →</a>
              </p>
            )}

            <label className="toggle">
              <input type="checkbox" checked={!!a.auto_apply_gform}
                onChange={(e) => s.set('auto_apply_gform')(e.target.checked)} />
              <span>Auto-submit Google Forms (only when every required question could be auto-filled)</span>
            </label>
            {a.auto_apply_gform && missingCore.length > 0 && (
              <p className="warn-text">
                Your profile is missing key fields ({missingCore.length}) — most forms won't fully auto-fill.{' '}
                <a onClick={() => navigate('/settings/profile')} style={{ cursor: 'pointer' }}>Complete it →</a>
              </p>
            )}

            <p className="muted" style={{ fontSize: 12.5 }}>
              Leave these off initially — review a few applications first. Anything the automation
              isn't confident about stays in "review" for you.
            </p>
          </div>
        </div>

        <button className="btn primary" style={{ padding: '15px', fontSize: 15 }}
          disabled={s.saving || !s.dirty} onClick={s.save}>
          {s.saving ? 'Saving…' : s.dirty ? 'Save automation settings' : 'All changes saved'}
        </button>
      </div>

      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount}
        onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
