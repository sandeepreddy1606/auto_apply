'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { useTelegramStatus } from '@/components/AppShell'
import {
  ChevronRight,
  DocIcon,
  FormIcon,
  GearIcon,
  ListIcon,
  LockIcon,
  MailIcon,
  SendIcon,
  HeartbeatIcon,
  TargetIcon,
  SparkIcon,
  BoltIcon,
} from '@/components/Icons'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { profileCompleteness } from '@/components/settings/shared'
import { api } from '@/lib/api'
import { career } from '@/lib/career-api'
import type { Settings } from '@/lib/types'

function Row({
  icon,
  title,
  sub,
  subClass,
  to,
}: {
  icon: ReactNode
  title: string
  sub: ReactNode
  subClass?: string
  to: string
}) {
  const navigate = useNavigate()
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

export default function SettingsHubPage() {
  const { tg } = useTelegramStatus()
  const [settings, setSettings] = useState<Settings | null>(null)

  const [health, setHealth] = useState<{ fail: number; warn: number } | null>(null)

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
    career
      .setup()
      .then((r) =>
        setHealth({
          fail: r.checks.filter((c) => c.status === 'fail').length,
          warn: r.checks.filter((c) => c.status === 'warn').length,
        }),
      )
      .catch(() => {})
  }, [])

  const healthSub = !health
    ? '…'
    : health.fail
      ? `${health.fail} item${health.fail > 1 ? 's' : ''} need attention`
      : health.warn
        ? 'Ready · some suggestions'
        : 'All set'

  const p = settings?.profile
  const { filled, total } = profileCompleteness(p || {})
  const resumeList = settings?.resumes || []
  const resumeSub = !settings
    ? '…'
    : resumeList.length === 0
      ? 'No resumes uploaded'
      : `${resumeList.length} resume${resumeList.length > 1 ? 's' : ''}${
          resumeList.some((r) => r.is_default) ? ' · default set' : ' · no default'
        }`
  const smtpReady = !!(
    settings?.smtp?.host &&
    settings?.smtp?.username &&
    settings?.smtp?.password
  )
  const autoOn =
    settings?.automation?.auto_apply_email || settings?.automation?.auto_apply_gform
  const tplDefault =
    settings &&
    settings.email_template?.subject === 'Application for {job_title} - {full_name}'

  return (
    <>
      <PageHeader
        large
        title="Settings"
        sub="Everything the automation needs, one section per page"
      />

      <div className="section" style={{ marginTop: 0 }}>
        <h3>Career-page applications</h3>
      </div>
      <div className="hub-list" style={{ marginBottom: 22 }}>
        <Row
          to="/settings/setup"
          icon={<HeartbeatIcon style={{ width: 19, height: 19 }} />}
          title="Setup & health"
          sub={healthSub}
          subClass={health?.fail ? 'warn-text' : health ? 'success-text' : ''}
        />
        <Row
          to="/settings/preferences"
          icon={<TargetIcon style={{ width: 19, height: 19 }} />}
          title="Job preferences"
          sub={
            settings
              ? settings.job_prefs?.target_roles?.length
                ? settings.job_prefs.target_roles.join(', ')
                : 'No target roles yet'
              : '…'
          }
          subClass={settings && !settings.job_prefs?.target_roles?.length ? 'warn-text' : ''}
        />
        <Row
          to="/settings/resume"
          icon={<DocIcon style={{ width: 19, height: 19 }} />}
          title="Resume"
          sub="Base LaTeX · issues · fact bank · skills · output"
        />
        <Row
          to="/settings/answers"
          icon={<FormIcon style={{ width: 19, height: 19 }} />}
          title="Application answers"
          sub="Work authorization, notice, CTC, EEO · learned answers"
        />
        <Row
          to="/settings/ai"
          icon={<SparkIcon style={{ width: 19, height: 19 }} />}
          title="AI"
          sub={settings ? (settings.ai?.provider === 'manual' ? 'Manual copy/paste' : 'Claude Code (your Pro plan)') : '…'}
        />
        <Row
          to="/settings/apply"
          icon={<BoltIcon style={{ width: 19, height: 19 }} />}
          title="Apply automation"
          sub={
            settings
              ? `${settings.apply_automation?.headless ? 'Headless' : 'Visible'} browser · up to ${settings.apply_automation?.daily_cap ?? 20}/day`
              : '…'
          }
        />
      </div>

      <div className="section" style={{ marginTop: 0 }}>
        <h3>Profile & messaging</h3>
      </div>
      <div className="hub-list">
        <Row
          to="/settings/profile"
          icon={<ListIcon style={{ width: 19, height: 19 }} />}
          title="Profile"
          sub={settings ? `${filled}/${total} fields filled — used for forms & emails` : '…'}
          subClass={settings && filled < 7 ? 'warn-text' : ''}
        />

        <Row
          to="/settings/resumes"
          icon={<DocIcon style={{ width: 19, height: 19 }} />}
          title="Resumes"
          sub={resumeSub}
          subClass={
            settings && resumeList.length > 0 && !resumeList.some((r) => r.is_default)
              ? 'warn-text'
              : ''
          }
        />

        <Row
          to="/settings/telegram"
          icon={<SendIcon style={{ width: 19, height: 19 }} />}
          title="Telegram"
          sub={
            tg.state === 'connected'
              ? '● Connected — listening for job posts'
              : 'Not connected'
          }
          subClass={tg.state === 'connected' ? 'success-text' : ''}
        />

        <Row
          to="/settings/email"
          icon={<MailIcon style={{ width: 19, height: 19 }} />}
          title="Email sending"
          sub={settings ? (smtpReady ? settings.smtp.username : 'Not configured') : '…'}
          subClass={settings && !smtpReady ? 'warn-text' : ''}
        />

        <Row
          to="/settings/template"
          icon={<FormIcon style={{ width: 19, height: 19 }} />}
          title="Email template"
          sub={settings ? (tplDefault ? 'Default template' : 'Customized') : '…'}
        />

        <Row
          to="/settings/automation"
          icon={<GearIcon style={{ width: 19, height: 19 }} />}
          title="Automation"
          sub={
            settings
              ? autoOn
                ? 'Auto-apply is ON'
                : 'Off — everything waits for your review'
              : '…'
          }
          subClass={autoOn ? 'success-text' : ''}
        />

        <Row
          to="/settings/security"
          icon={<LockIcon style={{ width: 19, height: 19 }} />}
          title="Account & security"
          sub="Email · password · devices · sign out"
        />
      </div>
    </>
  )
}
