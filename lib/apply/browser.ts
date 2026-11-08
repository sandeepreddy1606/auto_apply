/**
 * The automation browser: one persistent Chromium profile (data/browser-profile)
 * owned by the worker. Visible by default so you can watch, type, and solve
 * CAPTCHAs; logins you make in it persist across runs. Separate from your
 * everyday browser profile.
 *
 * No stealth or fingerprint tricks: it's a normal browser at normal speed.
 */
import path from 'node:path'

import type { BrowserContext, Page } from 'playwright'

import { DATA_DIR } from '@/lib/server/paths'
import * as settingsStore from '@/lib/server/settings'

export const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile')

const G = Symbol.for('autoapply.browser')
type State = {
  ctx: BrowserContext | null
  headless: boolean | null
  pages: Map<number, Page>
  lastUsed: Map<number, number>
  launching: Promise<BrowserContext> | null
}
type GlobalWith = typeof globalThis & { [G]?: State }

function state(): State {
  const g = globalThis as GlobalWith
  if (!g[G]) g[G] = { ctx: null, headless: null, pages: new Map(), lastUsed: new Map(), launching: null }
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
  'google.com', 'gstatic.com', 'recaptcha.net', 'hcaptcha.com', 'cloudflare.com', 'challenges.cloudflare.com',
  'linkedin.com', 'accounts.google.com', 'login.microsoftonline.com', 'microsoft.com',
]

export function isAllowedHost(host: string, jobHost: string, extra: string[]): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '')
  const jh = jobHost.toLowerCase().replace(/:\d+$/, '')
  // IPs and localhost are their own "root"; domains allow their registrable parent.
  const root = (d: string) => (/^[\d.]+$/.test(d) || !d.includes('.') ? d : d.split('.').slice(-2).join('.'))
  const allowed = [...BASE_ALLOWED, ...extra, root(jh)]
  return allowed.some((d) => h === d || h.endsWith(`.${d}`))
}

export async function getContext(): Promise<BrowserContext> {
  const st = state()
  const headless = settingsStore.load().apply_automation.headless
  if (st.ctx && st.headless === headless) return st.ctx
  if (st.ctx && st.headless !== headless) await closeAll()
  if (st.launching) return st.launching
  st.launching = (async () => {
    let chromium: typeof import('playwright').chromium
    try {
      ;({ chromium } = await import('playwright'))
    } catch {
      throw new BrowserUnavailableError('Playwright is not installed. Run npm install, then install Chromium from Settings → Setup & health.')
    }
    try {
      const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
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

export async function newPageFor(sessionId: number, jobUrl: string): Promise<Page> {
  const existing = await pageFor(sessionId)
  if (existing) return existing
  const ctx = await getContext()
  const page = await ctx.newPage()
  const jobHost = new URL(jobUrl).hostname
  const extra = settingsStore.load().apply_automation.extra_domains
  // Block top-level navigations to unexpected sites (frames/resources are allowed so pages render).
  await page.route('**/*', (route) => {
    const req = route.request()
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      try {
        const host = new URL(req.url()).hostname
        if (!isAllowedHost(host, jobHost, extra)) return route.abort('blockedbyclient')
      } catch {
        /* data:, about: */
      }
    }
    return route.continue()
  })
  state().pages.set(sessionId, page)
  state().lastUsed.set(sessionId, Date.now())
  page.on('close', () => state().pages.delete(sessionId))
  return page
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
