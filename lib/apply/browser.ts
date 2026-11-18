/**
 * The automation browser: one persistent Chromium profile (data/browser-profile)
 * owned by the worker. Visible by default so you can watch, type, and solve
 * CAPTCHAs; logins you make in it persist across runs. Separate from your
 * everyday browser profile.
 *
 * No stealth or fingerprint tricks: it's a normal browser at normal speed.
 */
import type { BrowserContext, Page } from 'playwright'

import { browserKind, chromeExecutable, profileDir } from '@/lib/apply/browser-choice'
import type { BrowserKind } from '@/lib/apply/browser-choice'
import { contextHasGoogleSession, profileHasGoogleSession } from '@/lib/apply/google-account'
import * as settingsStore from '@/lib/server/settings'

/** The bundled-Chromium profile (the default). Use profileDir() for the active one. */
export const PROFILE_DIR = profileDir('chromium')

const G = Symbol.for('autoapply.browser')
type State = {
  ctx: BrowserContext | null
  headless: boolean | null
  kind: BrowserKind | null
  pages: Map<number, Page>
  lastUsed: Map<number, number>
  /** Hosts a session's page tried to open but the allowlist refused. */
  blocked: Map<number, Set<string>>
  launching: Promise<BrowserContext> | null
}
type GlobalWith = typeof globalThis & { [G]?: State }

function state(): State {
  const g = globalThis as GlobalWith
  if (!g[G]) g[G] = { ctx: null, headless: null, kind: null, pages: new Map(), lastUsed: new Map(), blocked: new Map(), launching: null }
  return g[G]!
}

export class BrowserUnavailableError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'BrowserUnavailableError'
  }
}

/** Domains the automation may navigate to besides the job's own site. */
const BASE_ALLOWED = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com', 'recruitee.com',
  'myworkdayjobs.com', 'myworkdaysite.com', 'workday.com', 'icims.com', 'taleo.net', 'successfactors.com',
  // More application systems that company career pages hand off to.
  'jobvite.com', 'oraclecloud.com', 'taleo.com', 'avature.net', 'bamboohr.com', 'breezy.hr', 'jazzhr.com',
  'applytojob.com', 'teamtailor.com', 'personio.de', 'personio.com', 'zohorecruit.com', 'zohorecruit.in',
  'freshteam.com', 'darwinbox.in', 'darwinbox.com', 'keka.com', 'eightfold.ai', 'phenompeople.com',
  'successfactors.eu', 'sapsf.com', 'jobs.lever.co', 'hire.lever.co', 'rippling.com', 'rippling-ats.com',
  'pinpointhq.com', 'comeet.com', 'comeet.co', 'gem.com', 'dover.com', 'wellfound.com', 'ultipro.com',
  'ukg.com', 'paylocity.com', 'adp.com', 'paycomonline.net', 'brassring.com', 'kenexa.com', 'hirebridge.com',
  'amazon.jobs', 'amazon.com', 'google.com', 'gstatic.com', 'recaptcha.net', 'hcaptcha.com', 'cloudflare.com',
  'challenges.cloudflare.com', 'linkedin.com', 'accounts.google.com', 'login.microsoftonline.com', 'login.live.com',
  'microsoft.com', 'microsoftonline.com', 'okta.com', 'auth0.com',
]

/** Two-part public suffixes: the registrable domain is the last three labels. */
const TWO_PART_SUFFIX = /\.(co|com|org|net|ac|gov|edu|ltd|firm|gen|ind)\.[a-z]{2}$/

function registrable(d: string): string {
  if (/^[\d.]+$/.test(d) || !d.includes('.')) return d // IPs and localhost are their own "root"
  const labels = d.split('.')
  return labels.slice(TWO_PART_SUFFIX.test(d) ? -3 : -2).join('.')
}

export function isAllowedHost(host: string, jobHost: string, extra: string[]): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '')
  const jh = jobHost.toLowerCase().replace(/:\d+$/, '')
  // The job's own registrable domain ("careers.tcs.co.in" → "tcs.co.in", not "co.in").
  const allowed = [...BASE_ALLOWED, ...extra, registrable(jh)]
  return allowed.some((d) => h === d || h.endsWith(`.${d}`))
}

/**
 * The automation browser. `headless` overrides Settings for one use: hidden
 * work (Google Forms) asks for a hidden browser on the same profile.
 */
export async function getContext(opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  const st = state()
  const headless = opts.headless ?? settingsStore.load().apply_automation.headless
  const kind = browserKind()
  if (st.ctx && st.headless === headless && st.kind === kind) return st.ctx
  if (st.ctx) await closeAll()
  if (st.launching) return st.launching
  st.launching = (async () => {
    let chromium: typeof import('playwright').chromium
    try {
      ;({ chromium } = await import('playwright'))
    } catch {
      throw new BrowserUnavailableError('Playwright is not installed. Run npm install, then install Chromium from Settings → Setup & health.')
    }
    try {
      const ctx = await chromium.launchPersistentContext(profileDir(kind), {
        // Hidden runs use the full browser in its new headless mode — the same
        // program that holds your Google sign-in — not the stripped-down shell.
        ...(kind === 'chrome' ? { channel: 'chrome' } : headless ? { channel: 'chromium' } : {}),
        headless,
        viewport: headless ? { width: 1280, height: 900 } : null,
        acceptDownloads: false,
        args: headless ? [] : ['--start-maximized'],
      })
      ctx.on('close', () => {
        const s = state()
        s.ctx = null
        s.pages.clear()
      })
      st.ctx = ctx
      st.headless = headless
      st.kind = kind
      return ctx
    } catch (e) {
      const msg = (e as Error).message
      if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
        throw new BrowserUnavailableError('Chromium for Playwright is not installed. Install it from Settings → Setup & health.')
      }
      if (/user data directory is already in use|ProcessSingleton/i.test(msg)) {
        throw new BrowserUnavailableError('The automation browser profile is open in another window. Close it and try again.')
      }
      throw new BrowserUnavailableError(`Couldn't start the browser: ${msg.split('\n')[0]}`)
    } finally {
      st.launching = null
    }
  })()
  return st.launching
}

export async function pageFor(sessionId: number): Promise<Page | null> {
  const p = state().pages.get(sessionId)
  if (p && !p.isClosed()) {
    state().lastUsed.set(sessionId, Date.now())
    return p
  }
  return null
}

/** Block top-level navigations to unexpected sites (frames/resources are allowed so pages render). */
async function guard(page: Page, sessionId: number, jobHost: string): Promise<void> {
  const extra = settingsStore.load().apply_automation.extra_domains
  await page.route('**/*', (route) => {
    const req = route.request()
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      try {
        const host = new URL(req.url()).hostname
        if (host && !isAllowedHost(host, jobHost, extra)) {
          const st = state()
          if (!st.blocked.has(sessionId)) st.blocked.set(sessionId, new Set())
          st.blocked.get(sessionId)!.add(host)
          return route.abort('blockedbyclient')
        }
      } catch {
        /* data:, about: */
      }
    }
    return route.continue()
  })
}

function track(sessionId: number, page: Page): void {
  state().pages.set(sessionId, page)
  state().lastUsed.set(sessionId, Date.now())
  page.on('close', () => {
    if (state().pages.get(sessionId) === page) state().pages.delete(sessionId)
  })
}

export async function newPageFor(sessionId: number, jobUrl: string): Promise<Page> {
  const existing = await pageFor(sessionId)
  if (existing) return existing
  const ctx = await getContext()
  const page = await ctx.newPage()
  state().blocked.delete(sessionId)
  await guard(page, sessionId, new URL(jobUrl).hostname)
  track(sessionId, page)
  return page
}

/**
 * The job page opened the application in a new tab ("Apply" with
 * target=_blank): make that tab this session's page, with the same guard.
 */
export async function adoptPage(sessionId: number, page: Page, jobUrl: string): Promise<Page> {
  const old = state().pages.get(sessionId)
  await guard(page, sessionId, new URL(jobUrl).hostname)
  track(sessionId, page)
  if (old && old !== page && !old.isClosed()) await old.close().catch(() => {})
  return page
}

/** Sites this session's page was stopped from opening (for the "blocked" message). */
export function blockedHosts(sessionId: number): string[] {
  return [...(state().blocked.get(sessionId) ?? [])]
}

/** A page in the visible browser that the app didn't open for an application (e.g. you signing in to a site). */
function userBusy(st: State): boolean {
  if (!st.ctx || st.headless) return false
  const ours = new Set(st.pages.values())
  return [...st.pages.values()].some((p) => !p.isClosed()) || st.ctx.pages().some((p) => !p.isClosed() && !ours.has(p) && p.url() !== 'about:blank')
}

/**
 * A page for work you don't need to watch (Google Forms): a hidden browser on
 * the same profile, so no window or tab pops up. When the visible browser is
 * in use (an application waiting for your review, a site you're signed into),
 * the profile can't be opened twice — the page opens there instead.
 */
export async function hiddenPageFor(key: number, url: string): Promise<{ page: Page; hidden: boolean }> {
  const st = state()
  await closePage(key)
  if (userBusy(st)) return { page: await newPageFor(key, url), hidden: false }
  const ctx = await getContext({ headless: true })
  const page = await ctx.newPage()
  state().blocked.delete(key)
  await guard(page, key, new URL(url).hostname)
  track(key, page)
  return { page, hidden: true }
}

/** After hidden work: close the hidden browser when nothing else uses it, so the visible one can start. */
export async function releaseHidden(): Promise<void> {
  const st = state()
  if (!st.ctx || !st.headless || settingsStore.load().apply_automation.headless) return
  if ([...st.pages.values()].some((p) => !p.isClosed())) return
  await closeAll()
}

export async function closePage(sessionId: number): Promise<void> {
  const p = state().pages.get(sessionId)
  state().pages.delete(sessionId)
  if (p && !p.isClosed()) await p.close().catch(() => {})
}

/** Close pages idle longer than the session timeout (called periodically by the worker). */
export async function reapIdle(): Promise<number> {
  const timeout = settingsStore.load().apply_automation.session_timeout_min * 60_000
  let n = 0
  for (const [sid, at] of state().lastUsed) {
    if (Date.now() - at > timeout) {
      await closePage(sid)
      state().lastUsed.delete(sid)
      n++
    }
  }
  return n
}

export async function closeAll(): Promise<void> {
  const st = state()
  st.pages.clear()
  const ctx = st.ctx
  st.ctx = null
  if (ctx) await ctx.close().catch(() => {})
}

/**
 * Render a JS-heavy page and return its HTML (used by the background JD
 * fetcher). Uses its own short-lived headless browser — never the visible
 * automation profile, so background work can't pop windows up on your screen.
 */
export async function renderPage(url: string): Promise<string> {
  const { chromium } = await import('playwright')
  const b = await chromium.launch({ headless: true })
  try {
    const page = await b.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    return await page.content()
  } finally {
    await b.close().catch(() => {})
  }
}

/** Settings → Apply automation → "Open to sign in": a blank tab in the automation profile. */
export async function openProfileWindow(url = 'about:blank'): Promise<void> {
  const ctx = await getContext()
  const page = await ctx.newPage()
  if (url !== 'about:blank') await page.goto(url).catch(() => {})
  await page.bringToFront().catch(() => {})
}

export type GoogleSignInResult = {
  /** signed_in: Google's session is in the profile. not_signed_in: the window closed without it. */
  state: 'signed_in' | 'not_signed_in' | 'timed_out' | 'busy' | 'failed'
  browser: BrowserKind
  message?: string
}

/**
 * Is the automation profile signed in to Google? Asks the running browser
 * when it's open (its cookie file is locked then), else reads the file.
 */
export async function googleSessionState(): Promise<boolean | null> {
  const ctx = state().ctx
  if (ctx) return contextHasGoogleSession(ctx).catch(() => null)
  return profileHasGoogleSession(profileDir())
}

/**
 * "Sign in to Google": open the automation profile as an ordinary browser
 * window — started by the app, but NOT under automation (no WebDriver, no
 * DevTools pipe), which is what Google's sign-in refuses — at Google's
 * sign-in page. You sign in yourself; the app never sees the password.
 * Close the window when done: the result says whether Google's session is
 * now in the profile, so "done" always means really signed in.
 *
 * Google Forms that need an account then open signed in, because the
 * automation reuses this same profile.
 */
export async function googleSignIn(maxMinutes = 20): Promise<GoogleSignInResult> {
  await closeAll() // the profile can be open in one browser at a time
  const kind = browserKind()
  let exe: string | null
  if (kind === 'chrome') exe = chromeExecutable()
  else {
    const { chromium } = await import('playwright')
    exe = chromium.executablePath()
  }
  const fs = await import('node:fs')
  if (!exe || !fs.existsSync(exe)) {
    return { state: 'failed', browser: kind, message: kind === 'chrome' ? 'Google Chrome was not found.' : 'Chromium for Playwright is not installed. Install it from Settings → Setup & health.' }
  }
  const dir = profileDir(kind)
  fs.mkdirSync(dir, { recursive: true })
  const { spawn } = await import('node:child_process')
  const startedAt = Date.now()
  const child = spawn(
    exe,
    [
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fdocs.google.com%2Fforms%2Fu%2F0%2F',
    ],
    { stdio: 'ignore', windowsHide: false },
  )
  const outcome = await new Promise<'closed' | 'timeout' | 'error'>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already closed */
      }
      resolve('timeout')
    }, maxMinutes * 60_000)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve('closed')
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve('error')
    })
  })
  if (outcome === 'error') return { state: 'failed', browser: kind, message: 'The browser could not be started.' }
  // A browser that exits within seconds handed the window to another copy
  // already running on this profile, so we can't tell when you finish.
  if (outcome === 'closed' && Date.now() - startedAt < 4_000) {
    return {
      state: 'busy',
      browser: kind,
      message: 'The automation browser profile is already open in another window. Close every automation browser window, then press “Sign in to Google” again.',
    }
  }
  // Let the browser finish writing its cookie file.
  await new Promise((r) => setTimeout(r, 1_500))
  const signed = await profileHasGoogleSession(dir)
  if (signed) return { state: 'signed_in', browser: kind }
  if (outcome === 'timeout') return { state: 'timed_out', browser: kind, message: 'The sign-in window was open for too long and was closed.' }
  return {
    state: 'not_signed_in',
    browser: kind,
    message:
      kind === 'chromium' && chromeExecutable()
        ? 'The window closed before a Google account was signed in. If Google said “This browser or app may not be secure”, switch the browser to Google Chrome in Settings → Apply automation, then sign in again.'
        : 'The window closed before a Google account was signed in. Sign in fully (until you see Google Forms), then close the window.',
  }
}
