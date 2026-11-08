/**
 * Starting an application from a job, and the gates that decide what you can
 * do next. Every refusal says why and where to fix it.
 */
import { applyUrlFor } from '@/lib/jobs/ats'
import { getJob } from '@/lib/jobs/store'
import { lintBase, hasBlockingIssues } from '@/lib/resume/lint'
import { createVersion, getDefaultBase, getDismissed, getVersion, listVersionsForSession } from '@/lib/resume/store'
import { compilerAvailable } from '@/lib/resume/compile'
import { HttpError } from '@/lib/server/http'
import { sql } from '@/lib/server/db'
import * as settingsStore from '@/lib/server/settings'
import { playwrightChromiumPath } from '@/lib/setup/tools'
import { enqueue } from '@/lib/tasks/queue'
import type { ApplySession } from '@/lib/types'

import { createSession, getSession, recentForCompany, submittedToday } from './sessions'

export interface Gate {
  ok: boolean
  reason: string | null
  fix: string | null
}

const pass: Gate = { ok: true, reason: null, fix: null }
const block = (reason: string, fix: string | null = null): Gate => ({ ok: false, reason, fix })

export async function startSession(jobId: number): Promise<{ session_id: number; warnings: string[]; existing: boolean }> {
  const job = await getJob(jobId)
  if (!job) throw new HttpError(404, 'Job not found')
  const warnings: string[] = []

  // One live session per job: reopen it instead of starting over.
  const open = await sql.one(
    "SELECT id, status FROM apply_sessions WHERE job_id = ? AND status NOT IN ('cancelled', 'failed') ORDER BY id DESC LIMIT 1",
    [jobId],
  )
  if (open) {
    if (String(open.status) === 'submitted') warnings.push('You already applied to this job.')
    return { session_id: Number(open.id), warnings, existing: true }
  }

  const settings = settingsStore.load()
  if ((await submittedToday()) >= settings.apply_automation.daily_cap) {
    throw new HttpError(429, `Daily limit of ${settings.apply_automation.daily_cap} applications reached (Settings → Apply automation).`)
  }
  const recent = await recentForCompany(job.company_id, settings.apply_automation.duplicate_days, jobId)
  if (recent.length) {
    warnings.push(`You applied to ${job.company_name} ${Math.round((Date.now() - Date.parse(recent[0].submitted_at)) / 86_400_000)} day(s) ago (${recent[0].job_title}).`)
  }

  const base = await getDefaultBase()
  if (!base) throw new HttpError(400, 'Add your base resume first (Settings → Resume).')

  // Refresh a stale or missing JD in the background so the snapshot is current.
  const stale = !job.jd_fetched_at || Date.now() - Date.parse(job.jd_fetched_at) > 7 * 86_400_000
  if (stale) await enqueue('jobs.fetch_jd', { job_id: jobId }, { dedupeKey: `jd:${jobId}` })

  const applyUrl = job.apply_url || applyUrlFor(job.ats_type || 'custom', job.url)
  const sid = await createSession({ job_id: jobId, ats_type: job.ats_type, apply_url: applyUrl, jd_snapshot: job.description_text })
  // Version 1: an untouched copy of your base, so you can also apply with it as-is.
  await createVersion({ base_id: base.id, job_id: jobId, session_id: sid, latex: base.latex, generated_by: 'base', status: 'draft' })
  return { session_id: sid, warnings, existing: false }
}

export async function canGenerate(): Promise<Gate> {
  const base = await getDefaultBase()
  if (!base) return block('No base resume yet.', '/settings/resume')
  const issues = lintBase(base.latex, settingsStore.load().profile, await getDismissed(base.id))
  if (hasBlockingIssues(issues)) {
    const n = issues.filter((i) => i.severity === 'block').length
    return block(`${n} base-resume issue${n > 1 ? 's' : ''} to resolve first.`, '/settings/resume?tab=issues')
  }
  return pass
}

export async function canLock(versionId: number): Promise<Gate> {
  const v = await getVersion(versionId)
  if (!v) return block('Version not found.')
  if (!compilerAvailable()) return block('Install pdfLaTeX to compile your resume.', '/settings/setup')
  if (!v.compile_log?.ok || !v.pdf_path) return block('Compile this version successfully first.')
  if (v.ats_report?.checks.some((c) => c.id === 'todo' && c.status === 'fail')) return block('The PDF still contains “TODO”.', '/settings/resume?tab=issues')
  return pass
}

export async function canFill(s: ApplySession): Promise<Gate> {
  if (!s.resume_version_id) return block('Choose and lock a resume version first.')
  if (!playwrightChromiumPath()) return block('Install the automation browser first.', '/settings/setup')
  const { workerAlive } = await import('@/lib/setup/checks')
  if (!(await workerAlive())) return block('The background worker isn’t running.', '/settings/setup')
  if (['filling', 'submitting'].includes(s.status)) return block('Already working on it…')
  if (['submitted', 'cancelled'].includes(s.status)) return block(`This application is ${s.status}.`)
  return pass
}

export async function canSubmit(s: ApplySession): Promise<Gate> {
  if (s.status !== 'reviewing') return block(s.status === 'needs_input' ? 'Answer the highlighted questions first.' : `Not ready (${s.status.replace('_', ' ')}).`)
  if (!s.fill_plan?.final_step_reached) return block('The form has more steps — continue filling.')
  return pass
}

export async function gatesFor(sid: number): Promise<Record<string, Gate>> {
  const s = await getSession(sid)
  if (!s) return {}
  const versions = await listVersionsForSession(sid)
  const latest = versions[0]
  return {
    generate: await canGenerate(),
    lock: latest ? await canLock(latest.id) : block('No version yet'),
    fill: await canFill(s),
    submit: await canSubmit(s),
  }
}
