'use client'

import { useNavigate } from '@/components/Navigation'
import PageHeader from '@/components/PageHeader'
import {
  CORE_FIELDS,
  LoadError,
  SaveBar,
  useGuardedBack,
  useSection,
} from '@/components/settings/shared'
import type { AutomationConfig } from '@/lib/types'

export default function AutomationPage() {
  const s = useSection<AutomationConfig & Record<string, unknown>>('automation', null)
  const back = useGuardedBack()
  const navigate = useNavigate()

  if (s.loadError) {
    return (
      <>
        <PageHeader title="Automation" backTo="/settings" />
        <LoadError message={s.loadError} onRetry={s.load} />
      </>
    )
  }
  if (!s.data) {
    return (
      <>
        <PageHeader title="Automation" backTo="/settings" />
        <p className="muted">Loading…</p>
      </>
    )
  }

  const a = s.data
  const smtp = s.full?.smtp
  const profile = s.full?.profile
  const smtpReady = !!(smtp?.host && smtp?.username && smtp?.password)
  const missingCore = CORE_FIELDS.filter((k) => !String(profile?.[k] || '').trim())

  return (
    <>
      <PageHeader
        title="Automation"
        sub="What happens when a new job post arrives"
        onBack={back}
      />

      <div className="settings-stack">
        <div className="card">
          <div className="stack">
            <label className="toggle">
              <input
                type="checkbox"
                checked={!!a.auto_apply_email}
                onChange={(e) => s.set('auto_apply_email')(e.target.checked)}
              />
              <span>
                Auto-send email applications for incoming posts (when HR email + role were
                detected)
              </span>
            </label>
            {a.auto_apply_email && !smtpReady && (
              <p className="warn-text">
                SMTP isn&apos;t configured yet — auto-emails will fail.{' '}
                <a onClick={() => navigate('/settings/email')} style={{ cursor: 'pointer' }}>
                  Set it up
                </a>
              </p>
            )}
            {a.auto_apply_email && !String(profile?.resume_path || '').trim() && (
              <p className="warn-text">
                No resume file path set — auto-emails will go out without an attachment.{' '}
                <a
                  onClick={() => navigate('/settings/profile')}
                  style={{ cursor: 'pointer' }}
                >
                  Add it
                </a>
              </p>
            )}

            <label className="toggle">
              <input
                type="checkbox"
                checked={!!a.auto_apply_gform}
                onChange={(e) => s.set('auto_apply_gform')(e.target.checked)}
              />
              <span>
                Auto-submit Google Forms (only when every required question could be
                auto-filled)
              </span>
            </label>
            {a.auto_apply_gform && missingCore.length > 0 && (
              <p className="warn-text">
                Your profile is missing key fields ({missingCore.length}) — most forms
                won&apos;t fully auto-fill.{' '}
                <a
                  onClick={() => navigate('/settings/profile')}
                  style={{ cursor: 'pointer' }}
                >
                  Complete it
                </a>
              </p>
            )}

            <label className="toggle">
              <input type="checkbox" checked={a.gform_use_ai !== false} onChange={(e) => s.set('gform_use_ai')(e.target.checked)} />
              <span>
                Let the AI answer Google Form questions your profile and saved answers don&apos;t cover (degree, branch,
                “are you available…”, “tell us about yourself”). It uses your resume and the job post, copies options exactly,
                never makes up marks, scores or dates, and skips forms you don&apos;t qualify for. Uses your Claude subscription.
              </span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={!!a.gform_tick_declarations} onChange={(e) => s.set('gform_tick_declarations')(e.target.checked)} />
              <span>
                Tick standard declarations on Google Forms for me (“I confirm the information I gave is correct”). Off: forms
                with a required declaration stop for you to tick it.
              </span>
            </label>

            <p className="muted" style={{ fontSize: 12.5 }}>
              Leave these off initially — review a few applications first. Anything the
              automation isn&apos;t confident about stays in &quot;review&quot; for you.
            </p>
          </div>
        </div>

        <div className="card">
          <h3>Careers-page links in Telegram posts</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            When a post says “apply on our careers page”, pressing Apply opens it in the automation browser, attaches your
            PDF resume from Settings → Resumes and fills the form from your profile and application answers.
          </p>
          <div className="stack">
            <label className="toggle">
              <input type="checkbox" checked={a.link_auto_submit !== false} onChange={(e) => s.set('link_auto_submit')(e.target.checked)} />
              <span>
                Submit the form after filling it, when every required answer is filled, it reached the last page and no
                CAPTCHA appeared. Otherwise it stops and the post shows what it needs from you.
              </span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={!!a.auto_apply_link} onChange={(e) => s.set('auto_apply_link')(e.target.checked)} />
              <span>Start applying on careers-page links as soon as a new post arrives (without pressing Apply)</span>
            </label>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Sign-in pages, CAPTCHAs and legal consent boxes always wait for you. Turn off the first switch to check
              every form yourself before it’s sent.
            </p>
          </div>
        </div>

        <button
          className="btn primary"
          style={{ padding: '15px', fontSize: 15 }}
          disabled={s.saving || !s.dirty}
          onClick={s.save}
        >
          {s.saving ? 'Saving…' : s.dirty ? 'Save automation settings' : 'All changes saved'}
        </button>
      </div>

      <SaveBar
        dirty={s.dirty}
        saving={s.saving}
        errorCount={s.errorCount}
        onSave={s.save}
        onDiscard={s.discard}
      />
    </>
  )
}
