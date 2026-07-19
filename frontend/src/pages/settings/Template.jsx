import { useState } from 'react'
import { api } from '../../api'
import { useToast } from '../../Toast'
import PageHeader from '../../components/PageHeader'
import {
  Input, useSection, useGuardedBack, SaveBar, LoadError,
  renderTemplate, KNOWN_PLACEHOLDERS,
} from './shared'

export default function TemplatePage() {
  const s = useSection('email_template', null)
  const back = useGuardedBack(s.dirty)
  const [showPreview, setShowPreview] = useState(false)
  const toast = useToast()

  if (s.loadError) return <><PageHeader title="Email template" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>
  if (!s.data) return <><PageHeader title="Email template" backTo="/settings" /><p className="muted">Loading…</p></>

  const t = s.data

  const tplText = `${t.subject || ''}\n${t.body || ''}`
  const unknownPlaceholders = [...new Set(
    [...tplText.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k) => !KNOWN_PLACEHOLDERS.has(k)),
  )]
  const previewCtx = {
    ...(s.full?.profile || {}),
    job_title: 'Frontend Developer', company: 'Acme Corp',
    location: 'Hyderabad', experience: '3+ years',
  }

  const resetTemplate = async () => {
    if (!window.confirm('Replace the subject and body with the default template?')) return
    try {
      const defaults = await api.getSettingsDefaults()
      s.setData({ ...defaults.email_template })
      toast('Template reset — remember to save.')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <>
      <PageHeader title="Email template" sub="Used for every email application" onBack={back} />

      <div className="settings-stack">
        <div className="card">
          <div className="stack">
            <Input label="Subject template" value={t.subject} onChange={s.set('subject')} />
            <label className="field">
              <span className="lbl">Body template</span>
              <textarea rows={12} value={t.body}
                onChange={(e) => s.set('body')(e.target.value)} />
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
                <div className="preview-subject">{renderTemplate(t.subject, previewCtx) || '(empty subject)'}</div>
                <pre>{renderTemplate(t.body, previewCtx) || '(empty body)'}</pre>
              </div>
            )}
          </div>
        </div>

        <button className="btn primary" style={{ padding: '15px', fontSize: 15 }}
          disabled={s.saving || !s.dirty} onClick={s.save}>
          {s.saving ? 'Saving…' : s.dirty ? 'Save template' : 'All changes saved'}
        </button>
      </div>

      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount}
        onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
