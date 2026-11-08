/**
 * Per-ATS behaviour: how to reach the form, move between steps, submit, and
 * recognise the confirmation page. Field extraction/filling is shared
 * (extract.ts); adapters only cover what differs between boards.
 */
import type { Page } from 'playwright'

export interface AtsAdapter {
  type: string
  matches(url: string): boolean
  /** Navigate to the job and reveal the application form. */
  open(page: Page, url: string): Promise<void>
  /** 'next' after moving forward a step, 'final' when the submit button is on this page. */
  next(page: Page): Promise<'next' | 'final'>
  submit(page: Page): Promise<void>
  confirmed(page: Page): Promise<boolean>
}

const SUBMIT_TEXT = /^(submit( application)?|apply( now)?|send application|complete application|finish|submit your application)$/i
const NEXT_TEXT = /^(next|continue|save (and|&) continue|next step|proceed)$/i
const CONFIRM_TEXT =
  /(thank you for (applying|your application|your interest)|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully (submitted|applied)|your application is (complete|in))/i

async function clickByText(page: Page, re: RegExp): Promise<boolean> {
  const candidates = page.locator('button, input[type="submit"], a[role="button"], [role="button"]')
  const n = await candidates.count()
  for (let i = n - 1; i >= 0; i--) {
    const c = candidates.nth(i)
    if (!(await c.isVisible().catch(() => false))) continue
    const text = ((await c.innerText().catch(() => '')) || (await c.getAttribute('value').catch(() => '')) || '').trim()
    if (re.test(text)) {
      await c.click()
      return true
    }
  }
  return false
}

async function hasButton(page: Page, re: RegExp): Promise<boolean> {
  const candidates = page.locator('button, input[type="submit"], [role="button"]')
  const n = await candidates.count()
  for (let i = 0; i < n; i++) {
    const c = candidates.nth(i)
    if (!(await c.isVisible().catch(() => false))) continue
    const text = ((await c.innerText().catch(() => '')) || (await c.getAttribute('value').catch(() => '')) || '').trim()
    if (re.test(text)) return true
  }
  return false
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}

async function genericConfirmed(page: Page): Promise<boolean> {
  if (/confirm|thank|success|submitted|applied/i.test(page.url())) return true
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
  return CONFIRM_TEXT.test(body)
}

const generic: AtsAdapter = {
  type: 'custom',
  matches: () => true,
  async open(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)
    // Many job pages show the description first with an "Apply" button.
    const formFields = await page.locator('form input:not([type=hidden]), form textarea').count()
    if (formFields < 2) {
      const clicked = await clickByText(page, /^(apply|apply now|apply for this (job|position|role)|i'?m interested)$/i)
      if (clicked) await settle(page)
    }
  },
  async next(page) {
    if (await hasButton(page, SUBMIT_TEXT)) return 'final'
    if (await clickByText(page, NEXT_TEXT)) {
      await settle(page)
      return 'next'
    }
    return 'final'
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
    if (!(await page.locator('#first_name, input[name="first_name"]').count())) {
      await clickByText(page, /^apply( for this job| now)?$/i)
      await settle(page)
    }
    await page.locator('#first_name, input[name="first_name"], #application-form').first().scrollIntoViewIfNeeded().catch(() => {})
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

/** A sign-in wall instead of a form (Workday, iCIMS, Taleo …). */
export async function loginRequired(page: Page): Promise<boolean> {
  const pw = await page.locator('input[type="password"]:visible').count()
  if (!pw) return false
  const fields = await page.locator('input:visible:not([type=password]):not([type=hidden]):not([type=checkbox])').count()
  return fields <= 3
}
