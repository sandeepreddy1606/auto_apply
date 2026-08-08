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
export async function ingestText(
  text: string,
  source = 'manual',
  channel: string | null = null,
): Promise<Application[]> {
  const trimmed = (text || '').trim()
  if (!trimmed) throw new Error('Empty message.')
  const created: Application[] = []
  for (const segment of parser.splitOpenings(trimmed)) {
    const record = await ingestOne(segment, source, channel)
    if (record) created.push(record)
  }
  return created
}

async function ingestOne(
  text: string,
  source: string,
  channel: string | null,
): Promise<Application | null> {
  const thash = parser.textHash(text)
  if (await db.hashExists(thash)) return null

  const parsed = parser.parseMessage(text)
  let status = 'review'
  let statusReason: string | null = null
  if (parsed.method === 'unknown') {
    status = 'manual'
    statusReason = 'No application link, form or email found in the message.'
  } else if (parsed.method === 'link') {
    statusReason = 'Applies on an external page — open the link to apply.'
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
      experience: parsed.experience,
      salary: parsed.salary,
      extra: {
        ...parsed.extra,
        all_emails: parsed.all_emails,
        all_form_urls: parsed.all_form_urls,
        other_urls: parsed.other_urls,
        subject_hint: parsed.subject_hint,
      },
      email_subject: parsed.subject_hint,
      status,
      status_reason: statusReason,
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
    throw new Error('This posting applies on an external page — open the link to apply.')
  }
  throw new Error('No apply method set — open the post and choose email or form.')
}

/** Fetch + parse the Google Form and suggest answers from the profile. */
export async function loadForm(app: Application): Promise<FormLoadResult> {
  if (!app.form_url) throw new Error('This application has no Google Form URL.')
  const form = await gform.fetchForm(app.form_url)
  const settings = settingsStore.load()
  const suggested = gform.suggestAnswers(form, settings.profile)
  // keep any answers the user already edited
  const stored = app.form_answers || {}
  const answers: FormAnswers = { ...suggested, ...stored }
  const missing = gform.unansweredRequired(form, answers)
  await db.updateApplication(app.id, { form_schema: form, form_answers: answers })
  return { form, answers, unanswered_required: missing }
}

export async function applyGform(
  app: Application,
  answers: FormAnswers | null = null,
): Promise<Application | null> {
  if (!claimApply(app.id)) throw new Error('This job is already being applied.')
  try {
    // Fetch the form and auto-fill from the profile (merging any answers the
    // user already edited / just submitted).
    let form
    let finalAnswers = answers
    try {
      form = app.form_schema || (await gform.fetchForm(app.form_url || ''))
      if (finalAnswers === null) {
        const settings = settingsStore.load()
        finalAnswers = {
          ...gform.suggestAnswers(form, settings.profile),
          ...(app.form_answers || {}),
        }
      }
    } catch (e) {
      return db.updateApplication(app.id, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
    }

    // Always persist the pre-filled draft so the UI can show it, even if we
    // can't submit yet.
    await db.updateApplication(app.id, {
      form_schema: form,
      form_answers: finalAnswers,
    })

    const missing = gform.unansweredRequired(form, finalAnswers)
    if (missing.length) {
      // Don't fail — keep it in review with the draft ready, and tell the caller
      // which questions still need the user's input.
      const names = missing.slice(0, 5).map((m) => m.title || '?').join(', ')
      await db.updateApplication(app.id, {
        status_reason: `${missing.length} question(s) need your input: ${names}`,
      })
      throw new NeedsInput(missing)
    }

    try {
      await gform.submitForm(form, finalAnswers)
    } catch (e) {
      return db.updateApplication(app.id, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        form_answers: finalAnswers,
      })
    }
    return db.updateApplication(app.id, {
      status: 'applied',
      applied_at: nowIso(),
      error: null,
      form_answers: finalAnswers,
      status_reason: null,
    })
  } finally {
    releaseApply(app.id)
  }
}

/**
 * Callback for the telegram listener. One message may create several
 * applications; handle optional auto-apply for each.
 */
export async function ingestFromTelegram(text: string, channel: string): Promise<void> {
  const records = await ingestText(text, 'telegram', channel)
  if (!records.length) return
  const automation = settingsStore.load().automation
  for (const record of records) {
    try {
      if (record.method === 'email' && automation.auto_apply_email) {
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
}

async function autoApplyGform(record: Application): Promise<void> {
  let form
  try {
    form = await gform.fetchForm(record.form_url || '')
  } catch (e) {
    if (e instanceof gform.GFormError) {
      await db.updateApplication(record.id, {
        status: 'manual',
        status_reason: e.message,
      })
      return
    }
    throw e
  }
  const settings = settingsStore.load()
  const answers = gform.suggestAnswers(form, settings.profile)
  const missing = gform.unansweredRequired(form, answers)
  await db.updateApplication(record.id, { form_schema: form, form_answers: answers })
  if (missing.length) {
    await db.updateApplication(record.id, {
      status_reason:
        'Auto-apply skipped: required questions could not be auto-filled.',
    })
    return
  }
  const fresh = await db.getApplication(record.id)
  if (fresh) await applyGform(fresh, answers)
}
