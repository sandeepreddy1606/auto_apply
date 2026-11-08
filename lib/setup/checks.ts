/**
 * Readiness checklist for Settings → Setup & health, plus gating helpers that
 * explain why an action is unavailable and link to the fix.
 */
import { compilerAvailable } from '@/lib/resume/compile'
import { lintBase, hasBlockingIssues } from '@/lib/resume/lint'
import { getDefaultBase, getDismissed } from '@/lib/resume/store'
import { heartbeatAge } from '@/lib/server/worker-supervisor'
import * as settingsStore from '@/lib/server/settings'
import { kvGet } from '@/lib/tasks/queue'
import type { SetupCheck } from '@/lib/types'

import { findTool, playwrightChromiumPath, toolVersion } from './tools'

export async function setupStatus(): Promise<{ checks: SetupCheck[]; installs: Record<string, unknown> }> {
  const s = settingsStore.load()
  const checks: SetupCheck[] = []
  const IS_WIN = process.platform === 'win32'

  const hb = await heartbeatAge()
  checks.push({
    id: 'worker',
    label: 'Background worker',
    status: hb.ageMs !== null && hb.ageMs < 20_000 ? 'ok' : 'fail',
    detail: hb.ageMs !== null && hb.ageMs < 20_000 ? `Running (pid ${String(hb.value?.pid ?? '?')})` : 'Not running — browser automation, AI and description fetches are paused',
    blocks: 'Generate, Fill, description fetches',
    fix: { kind: 'action', target: 'restart_worker', label: 'Restart worker' },
  })

  const p = s.profile
  const missing = (['full_name', 'email', 'phone', 'current_location'] as const).filter((k) => !String(p[k] || '').trim())
  checks.push({
    id: 'profile',
    label: 'Profile',
    status: missing.length ? 'fail' : 'ok',
    detail: missing.length ? `Missing: ${missing.map((m) => m.replace('_', ' ')).join(', ')}` : `${p.full_name} · ${p.email}`,
    blocks: 'Fill',
    fix: { kind: 'link', target: '/settings/profile', label: 'Open Profile' },
  })

  checks.push({
    id: 'job_prefs',
    label: 'Job preferences',
    status: s.job_prefs.target_roles.length ? 'ok' : 'warn',
    detail: s.job_prefs.target_roles.length ? s.job_prefs.target_roles.join(', ') : 'No target roles — scores use your current role only',
    blocks: 'Accurate “Relevant” list',
    fix: { kind: 'link', target: '/settings/preferences', label: 'Set preferences' },
  })

  const base = await getDefaultBase()
  checks.push({
    id: 'base_resume',
    label: 'Base resume',
    status: base ? 'ok' : 'fail',
    detail: base ? `${base.name} (${base.latex.length.toLocaleString()} chars)` : 'Upload or paste your .tex',
    blocks: 'Generate',
    fix: { kind: 'link', target: '/settings/resume', label: 'Add base resume' },
  })
  if (base) {
    const issues = lintBase(base.latex, p, await getDismissed(base.id))
    const blocking = issues.filter((i) => i.severity === 'block').length
    checks.push({
      id: 'resume_issues',
      label: 'Base resume issues',
      status: hasBlockingIssues(issues) ? 'fail' : issues.length ? 'warn' : 'ok',
      detail: blocking ? `${blocking} must be fixed, ${issues.length - blocking} suggestions` : issues.length ? `${issues.length} suggestion(s)` : 'Clean',
      blocks: 'Generate, Submit',
      fix: { kind: 'link', target: '/settings/resume?tab=issues', label: 'Fix issues' },
    })
  }

  const pdflatex = compilerAvailable() ? await toolVersion('pdflatex') : null
  checks.push({
    id: 'miktex',
    label: 'pdfLaTeX (MiKTeX)',
    status: pdflatex ? 'ok' : 'fail',
    detail: pdflatex ?? 'Not installed',
    blocks: 'Compile, PDF preview, upload',
    fix: IS_WIN ? { kind: 'install', target: 'miktex', label: 'Install MiKTeX' } : { kind: 'info', target: 'Install TeX Live (texlive-latex-extra) with your package manager', label: 'How to install' },
  })
  if (pdflatex && /miktex/i.test(pdflatex)) {
    checks.push({
      id: 'miktex_autoinstall',
      label: 'MiKTeX on-the-fly packages',
      status: 'ok',
      detail: 'Missing LaTeX packages install automatically during compile (-enable-installer)',
      blocks: '',
      fix: { kind: 'install', target: 'miktex_autoinstall', label: 'Make it the default' },
    })
  }

  const pdftotext = findTool('pdftotext')
  checks.push({
    id: 'poppler',
    label: 'Poppler (pdftotext)',
    status: pdftotext ? 'ok' : 'fail',
    detail: pdftotext ? pdftotext : 'Not installed',
    blocks: 'ATS check, page count',
    fix: IS_WIN ? { kind: 'install', target: 'poppler', label: 'Install Poppler' } : { kind: 'info', target: 'Install poppler-utils', label: 'How to install' },
  })

  const chromium = playwrightChromiumPath()
  checks.push({
    id: 'chromium',
    label: 'Automation browser (Playwright Chromium)',
    status: chromium ? 'ok' : 'fail',
    detail: chromium ? 'Installed' : 'Not installed',
    blocks: 'Fill, Submit',
    fix: { kind: 'install', target: 'chromium', label: 'Install Chromium' },
  })

  const claude = findTool('claude') || s.ai.claude_path
  const llmTest = await kvGet<{ ok: boolean; detail: string }>('llm.last_test')
  checks.push({
    id: 'claude',
    label: 'Claude Code (your Pro plan)',
    status: s.ai.provider === 'manual' ? 'warn' : !claude ? 'fail' : llmTest?.value?.ok ? 'ok' : 'warn',
    detail:
      s.ai.provider === 'manual'
        ? 'Manual copy/paste mode selected'
        : !claude
          ? 'CLI not found — install Claude Code, then run `claude` once to sign in'
          : llmTest?.value
            ? llmTest.value.detail
            : 'Installed — press Test in Settings → AI to confirm you are signed in',
    blocks: 'Generate (Manual mode still works)',
    fix: { kind: 'link', target: '/settings/ai', label: 'Open AI settings' },
  })

  const a = s.apply_answers
  const answersMissing = (['authorized_india', 'notice_period', 'relocation'] as const).filter((k) => !a[k])
  checks.push({
    id: 'answers',
    label: 'Application answers',
    status: answersMissing.length ? 'warn' : 'ok',
    detail: answersMissing.length ? `Not set: ${answersMissing.map((k) => k.replace(/_/g, ' ')).join(', ')} — these will need you at review` : 'Core answers set',
    blocks: 'Hands-free fill',
    fix: { kind: 'link', target: '/settings/answers', label: 'Set answers' },
  })

  const installs: Record<string, unknown> = {}
  for (const tool of ['miktex', 'miktex_autoinstall', 'poppler', 'chromium']) {
    const st = await kvGet(`install:${tool}`)
    if (st) installs[tool] = st.value
  }
  return { checks, installs }
}

export async function workerAlive(): Promise<boolean> {
  const hb = await heartbeatAge()
  return hb.ageMs !== null && hb.ageMs < 20_000
}
