'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import {
  ChevronRight,
  DocIcon,
  FormIcon,
  ListIcon,
  LockIcon,
  MailIcon,
  HeartbeatIcon,
  TargetIcon,
  SparkIcon,
  BoltIcon,
} from '@/components/Icons'
import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import { ThemeSwitch } from '@/components/Theme'
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
      <ChevronRight style={{ width: 16, height: 16, color: 'var(--dim-2)' }} />
    </div>
  )
}

export default function SettingsHubPage() {
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
        ? 'Ready, with some suggestions'
        : 'All set'

  const p = settings?.profile
  const { filled, total } = profileCompleteness(p || {})
  const resumeList = settings?.resumes || []
  const resumeSub = !settings
    ? '…'
    : resumeList.length === 0
      ? 'No resumes uploaded'
      : `${resumeList.length} resume${resumeList.length > 1 ? 's' : ''}${
          resumeList.some((r) => r.is_default) ? ', default set' : ', no default chosen'
        }`
  const smtpReady = !!(
    settings?.smtp?.host &&
    settings?.smtp?.username &&
    settings?.smtp?.password
  )

  return (
    <>
      <PageHeader
        large
        title="Settings"
        sub="Everything the automation needs, one section per page"
      />

      <div className="settings-hub">
      <div className="hub-group">
      <h3>Career-page applications</h3>
      <div className="hub-list">
        <Row
          to="/settings/setup"
          icon={<HeartbeatIcon style={{ width: 17, height: 17 }} />}
          title="Setup & health"
          sub={healthSub}
          subClass={health?.fail ? 'warn-text' : health ? 'success-text' : ''}
        />
        <Row
          to="/settings/preferences"
          icon={<TargetIcon style={{ width: 17, height: 17 }} />}
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
          icon={<DocIcon style={{ width: 17, height: 17 }} />}
          title="Resume"
          sub="Your LaTeX resume, its issues, facts, skills and output"
        />
        <Row
          to="/settings/answers"
          icon={<FormIcon style={{ width: 17, height: 17 }} />}
          title="Application answers"
          sub="Work authorization, notice, pay, EEO and learned answers"
        />
        <Row
          to="/settings/ai"
          icon={<SparkIcon style={{ width: 17, height: 17 }} />}
          title="AI"
          sub={settings ? (settings.ai?.provider === 'manual' ? 'Manual copy/paste' : 'Claude Code (your Pro plan)') : '…'}
        />
        <Row
          to="/settings/apply"
          icon={<BoltIcon style={{ width: 17, height: 17 }} />}
          title="Apply automation"
          sub={
            settings
              ? `${settings.apply_automation?.headless ? 'Headless' : 'Visible'} browser, up to ${settings.apply_automation?.daily_cap ?? 20}/day`
              : '…'
          }
        />
      </div>
      </div>

      <div className="hub-group">
      <h3>Profile & account</h3>
      <div className="hub-list">
        <Row
          to="/settings/profile"
          icon={<ListIcon style={{ width: 17, height: 17 }} />}
          title="Profile"
          sub={settings ? `${filled}/${total} fields filled — used to fill application forms` : '…'}
          subClass={settings && filled < 7 ? 'warn-text' : ''}
        />

        <Row
          to="/settings/resumes"
          icon={<DocIcon style={{ width: 17, height: 17 }} />}
          title="Resumes"
          sub={resumeSub}
          subClass={
            settings && resumeList.length > 0 && !resumeList.some((r) => r.is_default)
              ? 'warn-text'
              : ''
          }
        />

        <Row
          to="/settings/email"
          icon={<MailIcon style={{ width: 17, height: 17 }} />}
          title="Email (password reset)"
          sub={settings ? (smtpReady ? settings.smtp.username : 'Optional — lets “Forgot password” email you a code') : '…'}
        />

        <Row
          to="/settings/security"
          icon={<LockIcon style={{ width: 17, height: 17 }} />}
          title="Account & security"
          sub="Email, password, devices and signing out"
        />
      </div>
      </div>

      <div className="hub-group">
      <h3>Appearance</h3>
      <div className="hub-list">
        <div className="appearance-row">
          <div>
            <div className="hub-title">Theme</div>
            <div className="hub-sub">Match your system, or always light or dark</div>
          </div>
          <ThemeSwitch />
        </div>
      </div>
      </div>
      </div>
    </>
  )
}
