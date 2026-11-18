/**
 * Applying to a post's Google Form.
 *
 *   public form, no uploads → answers worked out → sent directly (no browser)
 *   needs your Google account or has upload questions → filled in a HIDDEN
 *   browser on the automation profile (where you signed in to Google once):
 *     read the questions from the page → answers (yours, settings, profile,
 *     learned, AI) → the form's own pre-filled link → the chosen file into
 *     each upload question → Next … Submit → confirmation → applied.
 *
 * Nothing pops up on your screen. "Show the form" opens it in the visible
 * window, answers filled in, whenever you want to look or finish by hand.
 *
 * Stops — the post says why — when you're not signed in, a required question
 * or file is missing, the form doesn't fit you, or no confirmation appears.
 * Runs in the worker (browser lane).
 */
import type { Page } from 'playwright'

import * as db from '@/lib/server/db'
import { fetchForm, GFormError, parseFormHtml, prefillUrl, submitForm } from '@/lib/server/gform'
import { kvGet, kvSet } from '@/lib/tasks/queue'
import type { Application, GoogleForm } from '@/lib/types'

import { closePage, getContext, hiddenPageFor, newPageFor, pageFor, releaseHidden } from './browser'
import { missingReason, planFormAnswers } from './gform-answers'
import type { FormPlan } from './gform-answers'
import { planUploads } from './gform-files'
import type { UploadPick } from './gform-files'

/** Browser pages are keyed by number; a Google Form run uses the post's id, negated. */
export const formPageKey = (appId: number) => -appId

export const NEEDS_GOOGLE = 'This form needs your Google account. Press “Sign in to Google” once, then Apply again.'
const SHOW_HINT = 'Press “Show the form” to open it with your answers filled in.'
/** Remembered once a hidden run found itself signed out: Google forms then run in the visible window. */
const HIDDEN_KV = 'gform.hidden_signed_in'

const settle = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}

async function stop(app: Application, reason: string, status: 'review' | 'manual' | 'failed' | 'skipped' = 'review'): Promise<void> {
  await db.updateApplication(app.id, { status, status_reason: reason, error: status === 'failed' ? reason : null })
  await closePage(formPageKey(app.id))
}

/** Attach each upload question's own file (questions on later pages are done when reached). */
async function attachUploads(page: Page, picks: UploadPick[], done: Set<string>): Promise<string | null> {
  for (const pick of picks) {
    if (!pick.path || done.has(pick.key)) continue
    const item = page.locator('div[role="listitem"]').filter({ hasText: pick.title }).first()
    if (!(await item.count()) || !(await item.isVisible().catch(() => false))) continue // not on this page
    const btn = item.getByRole('button', { name: /add file/i }).first()
    if (!(await btn.count())) {
      done.add(pick.key) // already has a file
      continue
    }
    try {
      await btn.click()
      // Google's file picker opens in a dialog frame with a "Browse" button.
      const picker = page.frameLocator('iframe[src*="picker"], iframe[src*="docs.google.com/picker"]').first()
      const chooser = page.waitForEvent('filechooser', { timeout: 20_000 })
      await picker.getByRole('button', { name: /browse|select files from your device|upload/i }).first().click({ timeout: 20_000 })
      await (await chooser).setFiles(pick.path)
      // Done when the picker closes and the question shows the file.
      await page.locator('iframe[src*="picker"]').first().waitFor({ state: 'detached', timeout: 90_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      done.add(pick.key)
    } catch (e) {
      return `Couldn’t attach “${pick.name ?? 'your file'}” to “${pick.title}” (${(e as Error).message.split('\n')[0].slice(0, 80)}). ${SHOW_HINT}`
    }
  }
  return null
}

async function clickButton(page: Page, re: RegExp): Promise<boolean> {
  const b = page.locator('div[role="button"], button').filter({ hasText: re }).last()
  if (!(await b.count()) || !(await b.isVisible().catch(() => false))) return false
  await b.click()
  return true
}

const SUBMIT = /^\s*(submit|send|सबमिट)\s*$/i
const NEXT = /^\s*(next|continue|आगे)\s*$/i
const CONFIRMED = /your response has been recorded|response recorded|thanks for (filling|submitting)|आपका जवाब/i
const REQUIRED_EMPTY = /this is a required question|this question is required/i

/** Open the form, hidden when that works signed in; otherwise in the visible window. */
async function openForm(app: Application): Promise<Page | null> {
  const key = formPageKey(app.id)
  const hiddenOk = (await kvGet<boolean>(HIDDEN_KV).catch(() => null))?.value !== false
  let { page, hidden } = hiddenOk ? await hiddenPageFor(key, app.form_url!) : { page: await newPageFor(key, app.form_url!), hidden: false }
  const go = async () => {
    await page.goto(app.form_url!, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)
  }
  try {
    await go()
  } catch (e) {
    await stop(app, `Couldn’t open the form: ${(e as Error).message.split('\n')[0]}`, 'failed')
    return null
  }
  if (hidden && /accounts\.google\.com/.test(page.url())) {
    // Signed in, but not in the hidden browser: use the visible window from now on.
    await kvSet(HIDDEN_KV, false)
    await closePage(key)
    await releaseHidden()
    page = await newPageFor(key, app.form_url!)
    hidden = false
    await go().catch(() => {})
  } else if (hidden) {
    await kvSet(HIDDEN_KV, true)
  }
  if (/accounts\.google\.com/.test(page.url())) {
    await stop(app, NEEDS_GOOGLE)
    return null
  }
  return page
}

export async function runGformInBrowser(appId: number): Promise<{ status: string }> {
  const app = await db.getApplication(appId)
  if (!app || !app.form_url) return { status: 'missing' }
  const key = formPageKey(appId)
  await db.updateApplication(appId, { status: 'applying', status_reason: 'Opening the form with your Google account…', error: null })
  try {
    const page = await openForm(app)
    if (!page) return { status: 'stopped' }

    const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    if (/you need permission|only users in|can only be viewed by users in/i.test(body)) {
      await stop(app, 'This form only accepts accounts from one organisation, so it can’t be filled with your account.', 'manual')
      return { status: 'restricted' }
    }

    let form: GoogleForm
    try {
      form = parseFormHtml(await page.content(), page.url())
    } catch (e) {
      await stop(app, e instanceof GFormError ? e.message : `Couldn’t read the form: ${(e as Error).message}`, e instanceof GFormError ? 'manual' : 'failed')
      return { status: 'unreadable' }
    }

    // Marked so later edits and submits come back to the browser route.
    form.signed_in = true
    const plan = await preparedAnswers(app, form)
    if (typeof plan === 'string') return { status: plan }
    const answers = plan.answers

    await page.goto(prefillUrl(form, answers), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)

    const attached = new Set<string>()
    for (let step = 0; step < 12; step++) {
      const problem = await attachUploads(page, plan.uploads, attached)
      if (problem) {
        await stop(app, problem)
        return { status: 'upload_failed' }
      }
      // Signed-in forms can offer "Record <email> with my response": tick it when required.
      const record = page.getByRole('checkbox', { name: /record .* as the email|include .* email/i }).first()
      if ((await record.count()) && (await record.getAttribute('aria-checked')) === 'false') await record.click().catch(() => {})

      if (await clickButton(page, SUBMIT)) {
        await settle(page)
        await page.waitForTimeout(1500)
        const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
        if (/formResponse/.test(page.url()) || CONFIRMED.test(text)) {
          await db.updateApplication(appId, { status: 'applied', applied_at: new Date().toISOString(), status_reason: sentNote(plan), error: null, form_answers: answers })
          return { status: 'applied' }
        }
        await stop(
          app,
          REQUIRED_EMPTY.test(text)
            ? `The form says a required question is still empty. ${SHOW_HINT}`
            : `Pressed Submit, but no confirmation appeared — it may not have gone through. ${SHOW_HINT} If it did, press “I submitted it myself”.`,
        )
        return { status: 'unconfirmed' }
      }
      if (!(await clickButton(page, NEXT))) break
      await settle(page)
      const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
      if (REQUIRED_EMPTY.test(text)) {
        await stop(app, `A required question on a later page is empty. ${SHOW_HINT}`)
        return { status: 'needs_input' }
      }
    }
    await stop(app, `Couldn’t find the form’s Submit button. ${SHOW_HINT}`)
    return { status: 'no_submit' }
  } finally {
    await closePage(key)
    await releaseHidden()
  }
}

type Prepared = FormPlan & { uploads: UploadPick[] }

/**
 * Work out the answers (your own, settings, profile, learned, then AI) and
 * the file for each upload question, and save them on the post. Returns why
 * it stopped — with the post updated — when it can't go ahead.
 */
async function preparedAnswers(app: Application, form: GoogleForm): Promise<Prepared | 'ineligible' | 'needs_input'> {
  await db.updateApplication(app.id, { status: 'applying', status_reason: 'Working out the answers…' })
  const plan = await planFormAnswers(app, form, { useAi: true })
  const files = planUploads(app, form)
  form.answer_meta = plan.meta
  form.ineligible = plan.ineligible
  form.missing_notes = { ...plan.notes, ...Object.fromEntries(files.missing.map((m) => [files.picks.find((p) => p.title === m.title)?.key ?? '', m.note ?? ''])) }
  await db.updateApplication(app.id, { form_schema: form, form_answers: plan.answers })
  if (plan.ineligible) {
    await stop(app, `Not sent — this form doesn’t fit you: ${plan.ineligible}`, 'skipped')
    return 'ineligible'
  }
  const missing = [...plan.missing, ...files.missing]
  if (missing.length) {
    const why = plan.ai === 'unavailable' ? ' (The AI couldn’t be reached — check Settings → AI.)' : plan.ai === 'off' ? ' (AI answers are off in Settings → Automation.)' : ''
    await stop(app, missingReason(missing) + why)
    return 'needs_input'
  }
  return { ...plan, uploads: files.picks }
}

/** What to tell you after sending: answers the AI decided as a judgement call. */
function sentNote(plan: FormPlan): string | null {
  if (!plan.inferred.length) return null
  const list = plan.inferred.slice(0, 4).map((t) => `“${t}”`).join(', ')
  return `Sent. The AI chose ${plan.inferred.length > 1 ? 'these answers' : 'this answer'} for you: ${list}${plan.inferred.length > 4 ? ' …' : ''} — see them below.`
}

/**
 * Apply to a post's Google Form. Public forms without uploads are sent
 * directly; forms that need your Google account, have upload questions, or
 * that Google refuses over the direct route go through the (hidden) browser.
 */
export async function runGform(appId: number): Promise<{ status: string }> {
  const app = await db.getApplication(appId)
  if (!app || !app.form_url) return { status: 'missing' }
  if (app.form_schema?.signed_in) return runGformInBrowser(appId)
  await db.updateApplication(appId, { status: 'applying', status_reason: 'Reading the form…', error: null })
  let form: GoogleForm
  try {
    form = await fetchForm(app.form_url)
  } catch (e) {
    if (e instanceof GFormError && e.needsSignIn) return runGformInBrowser(appId)
    await stop(app, e instanceof GFormError ? e.message : `Couldn’t open the form: ${(e as Error).message}`, e instanceof GFormError ? 'manual' : 'failed')
    return { status: 'unreadable' }
  }
  if (form.fields.some((f) => f.type_code === 13)) return runGformInBrowser(appId)
  const plan = await preparedAnswers(app, form)
  if (typeof plan === 'string') return { status: plan }
  try {
    await submitForm(form, plan.answers)
  } catch {
    // Google turned the direct submission down: the browser route shows the form's own messages.
    return runGformInBrowser(appId)
  }
  await db.updateApplication(appId, { status: 'applied', applied_at: new Date().toISOString(), status_reason: sentNote(plan), error: null, form_answers: plan.answers })
  return { status: 'applied' }
}

/** "Show the form": open it in the visible window with your answers filled in. */
export async function focusForm(appId: number): Promise<boolean> {
  const app = await db.getApplication(appId)
  if (!app?.form_url) return false
  const key = formPageKey(appId)
  let p = await pageFor(key)
  if (!p || (await getContext()) !== p.context()) {
    if (p) await closePage(key)
    p = await newPageFor(key, app.form_url)
    const url = app.form_schema && app.form_answers ? prefillUrl(app.form_schema, app.form_answers) : app.form_url
    await p.goto(url).catch(() => {})
  }
  await p.bringToFront().catch(() => {})
  return true
}
