/**
 * Applying to a Telegram post whose "how to apply" is a careers-page link.
 *
 * Uses the same browser engine as the career-page flow (sign-in walls, new
 * tabs, embedded forms, hidden uploads, review) but stays separate from it:
 * the run is an apply session tied to the post (post_id), not to a scanned
 * job, so it never appears in Jobs, Companies or the Applications tracker.
 * Its progress is mirrored onto the post (sessions.ts → mirrorToPost).
 *
 *   Apply → follow short links → pick your PDF → session + locked resume
 *        → worker fills the form → submits when everything is answered
 *          (Settings → Automation), or stops and tells you what it needs.
 */
import fs from 'node:fs'
import path from 'node:path'

import { detectAts } from '@/lib/jobs/ats'
import { createVersion, getDefaultBase, pdfPathFor, updateVersion } from '@/lib/resume/store'
import * as db from '@/lib/server/db'
import { HttpError } from '@/lib/server/http'
import * as resumes from '@/lib/server/resumes'
import * as settingsStore from '@/lib/server/settings'
import { enqueue } from '@/lib/tasks/queue'
import type { Application } from '@/lib/types'

import { createSession, getSession, setStatus, submittedToday } from './sessions'

const SHORTENERS = /^(bit\.ly|lnkd\.in|tinyurl\.com|t\.co|goo\.gl|rb\.gy|cutt\.ly|shorturl\.at|is\.gd|ow\.ly|buff\.ly|rebrand\.ly|tiny\.cc|s\.id|shorturl\.me|forms\.gle)$/i

/** Follow redirects (short links, tracking links) to the page you'd actually land on. */
export async function resolveLanding(url: string): Promise<string> {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
    await r.body?.cancel().catch(() => {})
    return r.url || url
  } catch {
    return url
  }
}

/** The PDF to attach: tagged for this role, else your default, else any uploaded PDF. */
export function resumeFor(app: Application): { file: string; name: string } | null {
  const picked = resumes.pickForJob(app.job_title || '', app.raw_text || '')
  const p = picked ? resumes.pathFor(picked.id) : null
  if (p && /\.pdf$/i.test(p)) return { file: p, name: picked!.name || path.basename(p) }
  for (const r of resumes.listResumes()) {
    const f = resumes.pathFor(r.id)
    if (f && /\.pdf$/i.test(f)) return { file: f, name: r.name || r.original }
  }
  const legacy = (settingsStore.load().profile.resume_path || '').trim()
  if (legacy && /\.pdf$/i.test(legacy) && fs.existsSync(legacy)) return { file: legacy, name: path.basename(legacy) }
  return null
}

async function browserReady(): Promise<string | null> {
  const { playwrightChromiumPath } = await import('@/lib/setup/tools')
  if (!playwrightChromiumPath()) return 'Install the automation browser first (Settings → Setup & health).'
  const { workerAlive } = await import('@/lib/setup/checks')
  if (!(await workerAlive())) return 'The background worker isn’t running — restart the app.'
  return null
}

/** Start (or resume) applying to a post's careers-page link. Returns the updated post. */
export async function startPostApply(app: Application): Promise<Application | null> {
  if (app.method !== 'link' || !app.apply_url) throw new HttpError(400, 'This post has no careers-page link to apply on.')
  const settings = settingsStore.load()
  const autoSubmit = settings.automation.link_auto_submit !== false

  // An earlier run for this post: carry on with it instead of starting over.
  const existing = app.session_id ? await getSession(app.session_id) : null
  if (existing && existing.status === 'submitted') {
    return db.updateApplication(app.id, { status: 'applied', applied_at: existing.submitted_at ?? new Date().toISOString(), status_reason: null })
  }
  if (existing && ['filling', 'submitting'].includes(existing.status)) {
    throw new HttpError(409, 'Already applying to this post — watch its progress.')
  }
  if (existing && existing.status === 'unconfirmed') {
    throw new HttpError(409, 'The last submit wasn’t confirmed — open the post and say whether it went through.')
  }

  const problem = await browserReady()
  if (problem) throw new HttpError(409, problem)
  const cap = settings.apply_automation.daily_cap
  if ((await submittedToday()) >= cap) throw new HttpError(429, `Daily limit of ${cap} automated applications reached (Settings → Apply automation).`)

  if (existing && !['cancelled', 'failed'].includes(existing.status)) {
    await enqueue('apply.fill', { session_id: existing.id, auto_submit: autoSubmit }, { dedupeKey: `fill:${existing.id}` })
    return db.updateApplication(app.id, { status: 'applying', status_reason: 'Opening the careers page…', error: null })
  }

  const pdf = resumeFor(app)
  if (!pdf) {
    throw new HttpError(400, 'Upload your resume as a PDF in Settings → Resumes — careers pages need a file to attach.')
  }

  const landing = await resolveLanding(app.apply_url)
  const host = (() => {
    try {
      return new URL(landing).hostname
    } catch {
      return ''
    }
  })()
  if (SHORTENERS.test(host)) throw new HttpError(400, 'Couldn’t follow the short link to the real page — open the post and paste the full application link.')

  const ats = detectAts(landing)
  const sid = await createSession({ job_id: 0, post_id: app.id, ats_type: ats.type, apply_url: landing, jd_snapshot: app.raw_text })

  // Your PDF, copied so later changes in Settings → Resumes don't alter what was sent.
  const base = await getDefaultBase()
  const vid = await createVersion({ base_id: base?.id ?? 0, job_id: null, session_id: sid, latex: '', generated_by: 'upload', status: 'locked', hint: pdf.name })
  const dest = pdfPathFor(vid)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(pdf.file, dest)
  await updateVersion(vid, { pdf_path: dest, compile_log: { ok: true, errors: [] } })

  await db.updateApplication(app.id, { session_id: sid, apply_url: landing, status: 'applying', status_reason: 'Opening the careers page…', error: null })
  await setStatus(sid, 'resume_ready', { resume_version_id: vid }, { type: 'resume.locked', actor: 'user', data: { version_id: vid, uploaded_pdf: pdf.name, telegram_post: app.id } })
  await enqueue('apply.fill', { session_id: sid, auto_submit: autoSubmit }, { dedupeKey: `fill:${sid}` })
  return db.getApplication(app.id)
}
