/**
 * Per-ATS behaviour: how to reach the form, move between steps, submit, and
 * recognise the confirmation page. Field extraction/filling is shared
 * (extract.ts); adapters only cover what differs between boards.
 *
 * Every lookup covers the page and its frames: many company career sites embed
 * the real form (Greenhouse, iCIMS, Jobvite …) in an iframe.
 */
import type { Frame, Page } from 'playwright'

export type StepResult = 'next' | 'final' | 'none'

export interface AtsAdapter {
  type: string
  matches(url: string): boolean
  /**
   * Navigate to the job and reveal the application form. Returns the page the
   * form is on: a new tab when the site's "Apply" opens one.
   */
  open(page: Page, url: string): Promise<Page>
  /**
   * 'next' after moving forward a step, 'final' when the submit button is on
   * this page, 'none' when the page has neither (you finish it in the window).
   */
  next(page: Page): Promise<StepResult>
  submit(page: Page): Promise<void>
  confirmed(page: Page): Promise<boolean>
}

const SUBMIT_TEXT = /^(submit( application| my application| your application)?|apply( now)?|send( application)?|complete( application)?|finish( application)?|submit & apply)$/i
const NEXT_TEXT = /^(next|continue|save (and|&) continue|next step|proceed|save (and|&) next|continue to next step)( ?[›>→])?$/i
const APPLY_TEXT = /^(apply|apply now|apply here|apply online|apply for (this|the) (job|position|role)|apply to (this )?job|start (your )?application|i'?m interested)( ?[›>→↗])?$/i
const CONFIRM_TEXT =
  /(thank you for (applying|your application|your interest|submitting)|thanks for applying|application (has been |was )?(received|submitted|sent)|we('ve| have) received your application|successfully (submitted|applied)|your application is (complete|in|on its way))/i

/** The page first, then its frames (embedded application forms). */
export function frames(page: Page): Frame[] {
  const main = page.mainFrame()
  return [main, ...page.frames().filter((f) => f !== main && !f.isDetached())]
}

const BUTTONS = 'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]'

async function textOf(c: ReturnType<Frame['locator']>): Promise<string> {
  const t = ((await c.innerText().catch(() => '')) || (await c.getAttribute('value').catch(() => '')) || (await c.getAttribute('aria-label').catch(() => '')) || '')
  return t.replace(/\s+/g, ' ').trim()
}

async function findByText(page: Page, re: RegExp, selector = BUTTONS) {
  for (const f of frames(page)) {
    const candidates = f.locator(selector)
    const n = await candidates.count().catch(() => 0)
    // Last match first: the form's own button sits below headers/navigation.
    for (let i = n - 1; i >= 0; i--) {
      const c = candidates.nth(i)
      if (!(await c.isVisible().catch(() => false))) continue
      if (re.test(await textOf(c))) return c
    }
  }
  return null
}

async function clickByText(page: Page, re: RegExp, selector = BUTTONS): Promise<boolean> {
  const c = await findByText(page, re, selector)
  if (!c) return false
  await c.click()
  return true
}

async function hasButton(page: Page, re: RegExp): Promise<boolean> {
  return (await findByText(page, re)) !== null
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}

/** Form controls on the page or in any frame. */
export async function formFieldCount(page: Page): Promise<number> {
  let n = 0
  for (const f of frames(page)) {
    n += await f.locator('input:not([type=hidden]):not([type=search]):visible, textarea:visible, select:visible').count().catch(() => 0)
  }
  return n
}

/**
 * Click the job page's "Apply" (a button or a plain link) and follow it,
 * including into a new tab. Returns the page the form is on.
 */
export async function revealForm(page: Page): Promise<Page> {
  if ((await formFieldCount(page)) >= 3) return page
  const target = await findByText(page, APPLY_TEXT, `${BUTTONS}, a[href]`)
  if (!target) return page
  // A target=_blank link surely opens a tab; a script button might (window.open).
  const newTab = (await target.getAttribute('target').catch(() => null)) === '_blank'
  const popup = page.context().waitForEvent('page', { timeout: newTab ? 10_000 : 2_000 }).catch(() => null)
  await target.click().catch(() => {})
  const opened = await popup
  const next = opened ?? page
  await settle(next)
  return next
}

async function genericConfirmed(page: Page): Promise<boolean> {
  if (/confirm|thank|success|submitted|applied/i.test(page.url())) return true
  for (const f of frames(page)) {
    const body = await f.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    if (CONFIRM_TEXT.test(body)) return true
  }
  return false
}

const generic: AtsAdapter = {
  type: 'custom',
  matches: () => true,
  async open(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)
    // Many job pages show the description first with an "Apply" button or link.
    return revealForm(page)
  },
  async next(page) {
    if (await hasButton(page, SUBMIT_TEXT)) return 'final'
    if (await clickByText(page, NEXT_TEXT)) {
      await settle(page)
      return 'next'
    }
    return 'none'
  },
  async submit(page) {
    if (!(await clickByText(page, SUBMIT_TEXT))) throw new Error('Could not find the submit button on this page.')
    await settle(page)
  },
  confirmed: genericConfirmed,
}

const greenhouse: AtsAdapter = {
  ...generic,
  type: 'greenhouse',
  matches: (u) => /greenhouse\.io/.test(u),
  async open(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)
    // Old boards put the form below the JD; new ones open it via a button.
    let p = page
    if (!(await page.locator('#first_name, input[name="first_name"]').count())) p = await revealForm(page)
    await p.locator('#first_name, input[name="first_name"], #application-form').first().scrollIntoViewIfNeeded().catch(() => {})
    return p
  },
  async submit(page) {
    const btn = page.locator('#submit_app, button[type="submit"]:has-text("Submit"), button:has-text("Submit application")').first()
    if (await btn.count()) await btn.click()
    else await generic.submit(page)
    await settle(page)
  },
  async confirmed(page) {
    if (/\/confirmation|thank/i.test(page.url())) return true
    return genericConfirmed(page)
  },
}

const lever: AtsAdapter = {
  ...generic,
  type: 'lever',
  matches: (u) => /lever\.co/.test(u),
  async open(page, url) {
    const target = /\/apply\/?$/.test(url) ? url : `${url.replace(/\/+$/, '')}/apply`
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)
    return page
  },
  async submit(page) {
    const btn = page.locator('#btn-submit, button[type="submit"]').first()
    if (await btn.count()) await btn.click()
    else await generic.submit(page)
    await settle(page)
  },
  async confirmed(page) {
    if (/\/thanks|\/confirmation/i.test(page.url())) return true
    return genericConfirmed(page)
  },
}

const ashby: AtsAdapter = {
  ...generic,
  type: 'ashby',
  matches: (u) => /ashbyhq\.com/.test(u),
  async open(page, url) {
    const target = /\/application\/?$/.test(url) ? url : `${url.replace(/\/+$/, '')}/application`
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)
    return page
  },
  async submit(page) {
    if (!(await clickByText(page, /^submit application$/i))) await generic.submit(page)
    await settle(page)
  },
}

const workable: AtsAdapter = {
  ...generic,
  type: 'workable',
  matches: (u) => /workable\.com/.test(u),
  async open(page, url) {
    const target = /\/apply\/?$/.test(url) ? url : `${url.replace(/\/+$/, '')}/apply/`
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)
    return page
  },
}

export const ADAPTERS: AtsAdapter[] = [greenhouse, lever, ashby, workable]

export function adapterFor(atsType: string | null, url: string): AtsAdapter {
  return ADAPTERS.find((a) => a.type === atsType) ?? ADAPTERS.find((a) => a.matches(url)) ?? generic
}

/** A challenge the user must solve (visible CAPTCHA frame / Cloudflare check). */
export async function captchaVisible(page: Page): Promise<boolean> {
  const frames = page.locator(
    'iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com"][title*="challenge" i], iframe[src*="challenges.cloudflare.com"]',
  )
  const n = await frames.count()
  for (let i = 0; i < n; i++) if (await frames.nth(i).isVisible().catch(() => false)) return true
  return /just a moment|verify you are human|checking your browser/i.test(await page.title().catch(() => ''))
}

/** Identity providers: always a sign-in step, never the application itself. */
const IDP_HOST = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|signin\.aws\.amazon\.com|okta\.com|auth0\.com)$/i
const LOGIN_PATH = /(sign[-_ ]?in|log[-_ ]?in|signup|sign[-_ ]?up|register|create[-_]?account|\/auth(\/|$|\?)|\/sso\/|oauth|\/identity\/)/i
const LOGIN_HEADING = /^(sign in|log in|login|sign in to|log in to|create (an |your )?account|sign up|welcome back|enter your (email|password))\b/i

/**
 * A sign-in wall instead of a form (Workday, iCIMS, Taleo, Amazon, Google,
 * Microsoft …). Covers email-first sign-in pages that show no password box
 * yet, so your email isn't typed into someone's login form.
 */
export async function loginRequired(page: Page): Promise<boolean> {
  let host = ''
  let path = ''
  try {
    const u = new URL(page.url())
    host = u.hostname
    path = u.pathname + u.search
  } catch {
    /* about:blank */
  }
  if (IDP_HOST.test(host)) return true
  const fields = await page.locator('input:visible:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=search])').count()
  const files = await page.locator('input[type=file]').count()
  const pw = await page.locator('input[type="password"]:visible').count()
  if (pw) return fields <= 3 && !files
  if (fields > 2 || files) return false
  if (LOGIN_PATH.test(path)) return true
  const heading = await page.locator('h1:visible, h2:visible').first().innerText({ timeout: 1_000 }).catch(() => '')
  return LOGIN_HEADING.test(heading.trim())
}
