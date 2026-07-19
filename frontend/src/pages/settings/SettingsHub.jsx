import { useEffect, useState } from 'react'
import { api } from '../../api'
import { navigate } from '../../router'
import PageHeader from '../../components/PageHeader'
import { ChevronRight, ListIcon, SendIcon, MailIcon, GearIcon, FormIcon, LockIcon, DocIcon } from '../../components/Icons'
import { profileCompleteness } from './shared'

function Row({ icon, title, sub, subClass, to }) {
  return (
    <div className="card hub-row" onClick={() => navigate(to)}>
      <span className="hub-icon">{icon}</span>
      <div className="hub-text">
        <div className="hub-title">{title}</div>
        <div className={`hub-sub ${subClass || ''}`}>{sub}</div>
      </div>
      <ChevronRight style={{ width: 17, height: 17, color: 'var(--dim-2)' }} />
    </div>
  )
}

export default function SettingsHub({ tg }) {
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
  }, [])

  const p = settings?.profile
  const { filled, total } = profileCompleteness(p || {})
  const resumeList = settings?.resumes || []
  const resumeSub = !settings ? '…'
    : resumeList.length === 0 ? 'No resumes uploaded'
      : `${resumeList.length} resume${resumeList.length > 1 ? 's' : ''}${resumeList.some((r) => r.is_default) ? ' · default set' : ' · no default'}`
  const smtpReady = !!(settings?.smtp?.host && settings?.smtp?.username && settings?.smtp?.password)
  const autoOn = settings?.automation?.auto_apply_email || settings?.automation?.auto_apply_gform
  const tplDefault = settings
    && settings.email_template?.subject === 'Application for {job_title} - {full_name}'

  return (
    <>
      <PageHeader large title="Settings" sub="Everything the automation needs, one section per page" />

      <div className="hub-list">
        <Row to="/settings/profile"
          icon={<ListIcon style={{ width: 19, height: 19 }} />}
          title="Profile"
          sub={settings ? `${filled}/${total} fields filled — used for forms & emails` : '…'}
          subClass={settings && filled < 7 ? 'warn-text' : ''} />

        <Row to="/settings/resumes"
          icon={<DocIcon style={{ width: 19, height: 19 }} />}
          title="Resumes"
          sub={resumeSub}
          subClass={settings && resumeList.length > 0 && !resumeList.some((r) => r.is_default) ? 'warn-text' : ''} />

        <Row to="/settings/telegram"
          icon={<SendIcon style={{ width: 19, height: 19 }} />}
          title="Telegram"
          sub={tg.state === 'connected' ? '● Connected — listening for job posts' : 'Not connected'}
          subClass={tg.state === 'connected' ? 'success-text' : ''} />

        <Row to="/settings/email"
          icon={<MailIcon style={{ width: 19, height: 19 }} />}
          title="Email sending"
          sub={settings ? (smtpReady ? settings.smtp.username : 'Not configured') : '…'}
          subClass={settings && !smtpReady ? 'warn-text' : ''} />

        <Row to="/settings/template"
          icon={<FormIcon style={{ width: 19, height: 19 }} />}
          title="Email template"
          sub={settings ? (tplDefault ? 'Default template' : 'Customized') : '…'} />

        <Row to="/settings/automation"
          icon={<GearIcon style={{ width: 19, height: 19 }} />}
          title="Automation"
          sub={settings ? (autoOn ? 'Auto-apply is ON' : 'Off — everything waits for your review') : '…'}
          subClass={autoOn ? 'success-text' : ''} />

        <Row to="/settings/security"
          icon={<LockIcon style={{ width: 19, height: 19 }} />}
          title="Security"
          sub="Change password · sign out" />
      </div>
    </>
  )
}
