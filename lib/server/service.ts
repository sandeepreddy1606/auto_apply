/** Core workflows: ingest a message, apply via email, apply via Google Form. */
import type {
  Application,
  EmailPreview,
  FormAnswers,
  FormLoadResult,
  MissingQuestion,
  Settings,
} from '@/lib/types'

import * as db from './db'
import * as gform from './gform'
import * as mailer from './mailer'
import * as parser from './parser'
import { enrichPost } from './post-details'
import * as resumes from './resumes'
import * as settingsStore from './settings'

/**
 * Thrown when a Google Form can't be auto-submitted because required questions
 * are still blank. Carries the list so the UI can show the draft and let the
 * user complete it — the post is NOT marked failed.
 */
export class NeedsInput extends Error {
  missing: MissingQuestion[]

  constructor(missing: MissingQuestion[]) {
    super(`${missing.length} required question(s) need input`)
    this.name = 'NeedsInput'
    this.missing = missing
  }
}

// Guards against sending the same application twice when requests overlap
// (e.g. clicking a row's Apply during a bulk run, or two browser tabs). The app
// runs as a single process, so an in-process id set is sufficient.
const applying = new Set<number>()

function claimApply(appId: number): boolean {
  if (applying.has(appId)) return false
  applying.add(appId)
  return true
}

const releaseApply = (appId: number): void => {
  applying.delete(appId)
}

const nowIso = () => new Date().toISOString()

const isDuplicateError = (e: unknown): boolean => {
  const msg = String(e instanceof Error ? e.message : e).toLowerCase()
  return msg.includes('unique') || msg.includes('duplicate')
}

/**
 * Parse a raw message and store it. A single message may list several openings
 * — each becomes its own application. Returns the created records (empty array
 * if everything was a duplicate).
 */
/** Where a Telegram post came from (none for pasted posts). */
export interface PostOrigin {
  chatId?: string | null
  messageId?: number | null
  postedAt?: string | null
}

export async function ingestText(
  text: string,
  source = 'manual',
  channel: string | null = null,
  origin: PostOrigin = {},
): Promise<Application[]> {
  const trimmed = (text || '').trim()
  if (!trimmed) throw new Error('Empty message.')
  const created: Application[] = []
  for (const segment of parser.splitOpenings(trimmed)) {
    const record = await ingestOne(segment, source, channel, origin)
    if (record) created.push(record)
  }
  return created
}

async function ingestOne(
  text: string,
  source: string,
  channel: string | null,
  origin: PostOrigin = {},
): Promise<Application | null> {
  const thash = parser.textHash(text)
  if (await db.hashExists(thash)) return null

  const parsed = parser.parseMessage(text)
  // Experience written in the body, skills, work mode, job type.
  const more = enrichPost(text, parsed.job_title, { experience: parsed.experience, salary: parsed.salary, extra: parsed.extra })
  let status = 'review'
  let statusReason: string | null = null
  if (parsed.method === 'unknown') {
    status = 'manual'
    statusReason = 'No application link, form or email found in the message.'
  } else if (parsed.method === 'link') {
    statusReason = 'Applies on the company’s careers page — press Apply to fill it in the automation browser.'
  }

  try {
    return await db.insertApplication({
      source,
      channel,
      raw_text: text,
      text_hash: thash,
      method: parsed.method,
      email_to: parsed.email_to,
      form_url: parsed.form_url,
      apply_url: parsed.apply_url,
      job_title: parsed.job_title,
      company: parsed.company,
      location: parsed.location,
      experience: more.experience,
      salary: more.salary,
      extra: {
        ...more.extra,
        all_emails: parsed.all_emails,
        all_form_urls: parsed.all_form_urls,
        other_urls: parsed.other_urls,
        subject_hint: parsed.subject_hint,
      },
      email_subject: parsed.subject_hint,
      status,
      status_reason: statusReason,
      posted_at: origin.postedAt ?? null,
      tg_chat_id: origin.chatId ?? null,
      tg_message_id: origin.messageId ?? null,
    })
  } catch (e) {
    // Two identical messages ingested at the same moment can slip past the
    // hashExists check and collide on the UNIQUE text_hash — treat as a dup.
    if (isDuplicateError(e)) return null
    throw e
  }
}

/**
 * Pick the resume to attach for this job: role-matched > default > the legacy
 * single profile.resume_path. Returns [path, label].
 */
function resumeFor(
  app: Partial<Application>,
  settings: Settings,
): [string | null, string | null] {
  const picked = resumes.pickForJob(app.job_title || '')
  if (picked) {
    const p = resumes.pathFor(picked.id)
    if (p) return [p, picked.name]
  }
  const legacy = (settings.profile.resume_path || '').trim() || null
  return [legacy, legacy]
}

export function emailPreview(app: Application): EmailPreview {
  const settings = settingsStore.load()
  const ctx = mailer.buildContext(settings.profile, app)
  const template = settings.email_template || { subject: '', body: '' }
  const subject = app.email_subject || mailer.renderTemplate(template.subject || '', ctx)
  const body = app.email_body || mailer.renderTemplate(template.body || '', ctx)
  const [, label] = resumeFor(app, settings)
  return { to: app.email_to, subject, body, attachment: label }
}

export async function applyEmail(
  app: Application,
  overrides: { to?: string; subject?: string; body?: string } = {},
): Promise<Application | null> {
  if (!claimApply(app.id)) throw new Error('This job is already being applied.')
  try {
    const preview = emailPreview(app)
    const toAddr = overrides.to || preview.to || ''
    const subject = overrides.subject || preview.subject
    const body = overrides.body || preview.body
    const settings = settingsStore.load()
    const [resume] = resumeFor(app, settings) // role-matched resume, or default

    try {
      await mailer.sendEmail(settings.smtp, toAddr, subject, body, resume)
    } catch (e) {
      return db.updateApplication(app.id, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        email_to: toAddr,
        email_subject: subject,
        email_body: body,
      })
    }
    return db.updateApplication(app.id, {
      status: 'applied',
      applied_at: nowIso(),
      error: null,
      email_to: toAddr,
      email_subject: subject,
      email_body: body,
      status_reason: null,
    })
  } finally {
    releaseApply(app.id)
  }
}

/**
 * One-shot apply using stored/generated content — the engine behind the 'Apply'
 * button. Dispatches by method; throws for methods that can't be auto-applied
 * so the caller can report why.
 */
export async function autoApply(app: Application): Promise<Application | null> {
  const method = app.method
  if (method === 'email') {
    if (!(app.email_to || '').trim()) {
      throw new Error('No HR email on this post — open it to add one.')
    }
    return applyEmail(app)
  }
  if (method === 'gform') {
    if (!(app.form_url || '').trim()) {
      throw new Error('No Google Form URL on this post — open it to add one.')
    }
    return applyGform(app, null) // may throw NeedsInput (draft saved)
  }
  if (method === 'link') {
    if (!(app.apply_url || '').trim()) throw new Error('No application link on this post — open it to add one.')
    // Fills the careers page in the automation browser (worker), and submits
    // when every required answer is in place. Progress shows on the post.
    const { startPostApply } = await import('@/lib/apply/post-apply')
    return startPostApply(app)
  }
  throw new Error('No apply method set — open the post and choose email or form.')
}

/**
 * Fetch + parse the Google Form and show the answers it would get (your own,
 * settings, profile, learned; AI answers worked out earlier are kept). No AI
 * call here — that happens when you press Apply.
 */
export async function loadForm(app: Application): Promise<FormLoadResult> {
  if (!app.form_url) throw new Error('This application has no Google Form URL.')
  let form
  try {
    form = app.form_schema?.signed_in ? app.form_schema : await gform.fetchForm(app.form_url)
  } catch (e) {
    if (e instanceof gform.GFormError && e.needsSignIn) {
      if (app.form_schema) form = app.form_schema
      else throw new Error('This form needs your Google account. Press Apply to open it signed in; its questions will show here.')
    } else throw e
  }
  const { planFormAnswers } = await import('@/lib/apply/gform-answers')
  const plan = await planFormAnswers(app, form, { useAi: false })
  form = { ...form, answer_meta: plan.meta, ineligible: app.form_schema?.ineligible ?? null, missing_notes: app.form_schema?.missing_notes ?? {} }
  await db.updateApplication(app.id, { form_schema: form, form_answers: plan.answers })
  return { form, answers: plan.answers, unanswered_required: plan.missing }
}

/**
 * Apply to a post's Google Form. `answers` = what you filled in on the post
 * (remembered as yours, and for later forms). The worker works out the rest
 * (AI included) and sends it; progress shows on the post.
 */
export async function applyGform(
  app: Application,
  answers: FormAnswers | null = null,
): Promise<Application | null> {
  if (!claimApply(app.id)) throw new Error('This job is already being applied.')
  try {
    if (answers && app.form_schema) {
      const { recordYourAnswers } = await import('@/lib/apply/gform-answers')
      const mine = await recordYourAnswers(app, app.form_schema, answers)
      await db.updateApplication(app.id, { form_answers: mine.answers, form_schema: { ...app.form_schema, answer_meta: mine.meta } })
    }
    return await queueForm(app)
  } finally {
    releaseApply(app.id)
  }
}

/**
 * Callback for the telegram listener. One message may create several
 * applications; handle optional auto-apply for each.
 */
export async function ingestFromTelegram(
  text: string,
  channel: string,
  meta: { chatId: string; messageId: number | null; postedAt: string | null; live: boolean },
): Promise<number> {
  const records = await ingestText(text, 'telegram', channel, meta)
  if (!records.length) return 0
  // Automatic applying is for posts arriving now. History fetched when you add
  // a group (or catch up after downtime) waits for you to press Apply.
  if (!meta.live) return records.length
  const automation = settingsStore.load().automation
  for (const record of records) {
    try {
      if (record.method === 'link' && automation.auto_apply_link && record.apply_url) {
        const { startPostApply } = await import('@/lib/apply/post-apply')
        await startPostApply(record)
      } else if (record.method === 'email' && automation.auto_apply_email) {
        if (record.email_to && record.job_title) {
          await applyEmail(record)
        } else {
          await db.updateApplication(record.id, {
            status_reason: 'Auto-apply skipped: parse confidence too low.',
          })
        }
      } else if (record.method === 'gform' && automation.auto_apply_gform) {
        await autoApplyGform(record)
      }
    } catch (e) {
      console.error(
        `[autoapply.service] Auto-apply failed for application ${record.id}:`,
        e,
      )
    }
  }
  return records.length
}

/** Queue a Google Form for the worker (answers, AI, then sending). */
async function queueForm(app: Application): Promise<Application | null> {
  const { enqueue } = await import('@/lib/tasks/queue')
  await enqueue('apply.gform', { application_id: app.id }, { dedupeKey: `gform:${app.id}`, maxAttempts: 1 })
  return db.updateApplication(app.id, { status: 'applying', status_reason: 'Queued — working out the answers…', error: null })
}

async function autoApplyGform(record: Application): Promise<void> {
  // Same engine as pressing Apply: the worker answers (AI included) and sends,
  // or stops on the post with the questions it needs from you.
  await queueForm(record)
}

/** Once: fill the details older posts are missing (experience in the body, skills …). */
export async function enrichExistingPosts(): Promise<number> {
  let n = 0
  for (const app of await db.listApplications({ limit: 5000 })) {
    const more = enrichPost(app.raw_text, app.job_title, { experience: app.experience, salary: app.salary, extra: app.extra })
    if (more.experience !== app.experience || more.salary !== app.salary || JSON.stringify(more.extra) !== JSON.stringify(app.extra || {})) {
      await db.updateApplication(app.id, { experience: more.experience, salary: more.salary, extra: more.extra })
      n++
    }
  }
  return n
}

/**
 * Once: Google Form posts that failed before sign-in forms were supported
 * ("requires Google sign-in … apply manually") go back to "To apply", with
 * the new way to apply them.
 */
export async function reopenSignInForms(opts: { signedIn?: boolean } = {}): Promise<number> {
  const NEEDS = 'This form needs your Google account. Press “Sign in to Google” once, then Apply again.'
  const READY = 'You’re signed in to Google. Press Apply to fill this form with your account.'
  let n = 0
  for (const app of await db.listApplications({ method: 'gform', limit: 5000 })) {
    const text = `${app.error ?? ''} ${app.status_reason ?? ''}`
    const stoppedForAccount = /google sign-in|requires google|needs your google account|google account/i.test(text) && !/one organisation|organization-only/i.test(text)
    if (!stoppedForAccount) continue
    if (app.status === 'failed' || app.status === 'manual') {
      await db.updateApplication(app.id, { status: 'review', error: null, status_reason: opts.signedIn ? READY : NEEDS })
      n++
    } else if (app.status === 'review' && opts.signedIn && app.status_reason !== READY) {
      await db.updateApplication(app.id, { status_reason: READY })
      n++
    }
  }
  return n
}
