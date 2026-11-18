/**
 * Page audit: opens every page of a built app in Chromium at laptop and phone
 * sizes and reports crashes, console errors, failing API calls, horizontal
 * overflow and stuck "Loading…" states. Screenshots go to <out>.
 *
 *   npm run build
 *   node scripts/page-audit.mjs <out-dir> [data-dir-to-copy]
 *
 * With a data dir, a COPY of it is used (your real data is never touched)
 * and the first account is signed in directly. Without one, a fresh install
 * is created with a demo account. The worker and Telegram listener are off.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'aa-audit'))
const source = process.argv[3] ? path.resolve(process.argv[3]) : null
fs.mkdirSync(out, { recursive: true })

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-audit-data-'))
if (source) {
  for (const f of fs.readdirSync(source)) {
    if (f === 'browser-profile' || f === 'logs') continue
    fs.cpSync(path.join(source, f), path.join(data, f), { recursive: true })
  }
  // Never let the copy talk to Telegram as you.
  for (const f of ['telegram.session.txt', 'telegram.session']) fs.rmSync(path.join(data, f), { force: true })
} else {
  fs.mkdirSync(path.join(data, 'seed'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tests/fixtures/resume/base.tex'), path.join(data, 'seed', 'base_resume.tex'))
}

const env = { ...process.env, AUTO_APPLY_DATA_DIR: data, AUTO_APPLY_NO_WORKER: '1', AUTO_APPLY_NO_BACKGROUND: '1' }
delete env.DATABASE_URL
const TS = ['--experimental-strip-types', '--no-warnings', '--import', './scripts/ts-resolve.mjs']

let token = ''
if (source) {
  const r = spawnSync(process.execPath, [...TS, '--input-type=module', '-e',
    "const a = await import('./lib/server/auth.ts'); const { sql } = await import('./lib/server/db.ts');" +
    "const u = await sql.one('SELECT id FROM users ORDER BY id LIMIT 1'); if (!u) { console.log('NOUSER'); process.exit(0) }" +
    "const s = await a.createSession(Number(u.id), true, { userAgent: 'page-audit' }); console.log('TOKEN=' + s.token);" +
    // Re-score the copy the way the app does on start, so filters and scores are current.
    "const { rescoreJobs } = await import('./lib/jobs/store.ts'); await rescoreJobs(); process.exit(0)"],
  { cwd: ROOT, env, encoding: 'utf-8' })
  token = /TOKEN=(\S+)/.exec(r.stdout)?.[1] || ''
  if (!token) console.log('No account in the copied data; signing up a demo one.', r.stderr.slice(-400))
}

const PORT = 8990 + Math.floor(Math.random() * 9)
const API = `http://127.0.0.1:${PORT}`
const srv = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
srv.stdout.on('data', (d) => (serverLog += d))
srv.stderr.on('data', (d) => (serverLog += d))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 160; i++) {
  try {
    if ((await fetch(`${API}/api/health`)).ok) break
  } catch {}
  await sleep(500)
}

const preAuth = []
let browser
try {
  browser = await chromium.launch()
  // Sign-in pages, before any session.
  if (!token) {
    if (process.env.AUDIT_QUICK !== '1') for (const p of ['/signup', '/login', '/forgot']) preAuth.push(p)
    const su = await fetch(`${API}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Demo User', email: 'demo@example.com', password: 'demo-pass-123' }) })
    token = (await su.json()).token
  }
  const call = async (m, p, b) => {
    const r = await fetch(`${API}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: b ? JSON.stringify(b) : undefined })
    return r.headers.get('content-type')?.includes('json') ? r.json() : null
  }
  const firstId = (x) => (Array.isArray(x) ? x : x?.items || [])[0]?.id
  const jobId = firstId(await call('GET', '/api/jobs?view=all&limit=1'))
  const sid = firstId(await call('GET', '/api/apply'))
  const appId = firstId(await call('GET', '/api/applications?limit=1'))

  // AUDIT_QUICK=1: only the click paths and interactions below.
  const pages = process.env.AUDIT_QUICK === '1' ? [] : [
    '/', '/jobs', jobId && `/jobs/${jobId}`, sid && `/apply/${sid}`, '/tracker', '/companies', '/companies?tab=watched', '/companies/manage',
    '/applications', appId && `/applications/${appId}`, '/paste',
    '/settings', '/settings/setup', '/settings/profile', '/settings/preferences', '/settings/resume', '/settings/resume?tab=issues',
    '/settings/resume?tab=facts', '/settings/resume?tab=skills', '/settings/resume?tab=output', '/settings/resumes', '/settings/answers',
    '/settings/ai', '/settings/apply', '/settings/automation', '/settings/email', '/settings/template', '/settings/telegram', '/settings/security',
  ].filter(Boolean)

  const report = []
  const views = [['laptop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]
  for (const [vw, size] of views) {
    for (const [authed, list] of [[false, preAuth], [true, pages]]) {
      const ctx = await browser.newContext({ viewport: size, colorScheme: process.env.AUDIT_SCHEME === 'light' ? 'light' : 'dark' })
      if (authed) await ctx.addCookies([{ name: 'aa_session', value: token, url: API }])
      for (const p of list) {
        const page = await ctx.newPage()
        const issues = []
        page.on('pageerror', (e) => issues.push(`JS crash: ${e.message.split('\n')[0]}`))
        page.on('console', (m) => {
          if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push(`console: ${m.text().slice(0, 200)}`)
        })
        page.on('response', (r) => {
          const u = new URL(r.url())
          if (u.pathname.startsWith('/api/') && r.status() >= 400 && !(r.status() === 401 && !authed)) issues.push(`API ${r.status()} ${r.request().method()} ${u.pathname}`)
          if (!u.pathname.startsWith('/api/') && u.host === new URL(API).host && r.status() >= 400) issues.push(`HTTP ${r.status()} ${u.pathname}`)
        })
        try {
          // /apply keeps a live event stream open, so the network never goes idle there.
          await page.goto(`${API}${p}`, { waitUntil: p.startsWith('/apply') ? 'load' : 'networkidle', timeout: 30_000 })
        } catch (e) {
          issues.push(`navigation: ${e.message.split('\n')[0]}`)
        }
        await sleep(1800)
        const info = await page.evaluate(() => {
          const body = document.body.innerText || ''
          const wide = [...document.querySelectorAll('body *')].filter((el) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.right > window.innerWidth + 2 && getComputedStyle(el).position !== 'fixed'
          }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`)
          return {
            url: location.pathname + location.search,
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            wide,
            appError: /Application error|Unhandled Runtime Error|This page couldn.t load|Internal Server Error/i.test(body),
            loading: /^\s*(Loading…|Loading\.\.\.)\s*$/m.test(body) && body.length < 400,
            text: body.slice(0, 120).replace(/\s+/g, ' '),
          }
        })
        if (info.appError) issues.push('page shows an error screen')
        if (info.overflowX > 2) issues.push(`horizontal overflow ${info.overflowX}px (${info.wide.join(', ')})`)
        if (info.loading) issues.push('stuck on Loading…')
        if (!authed && info.url !== p.split('?')[0] && !info.url.startsWith(p)) issues.push(`redirected to ${info.url}`)
        if (authed && /^\/(login|signup)/.test(info.url)) issues.push(`bounced to ${info.url}`)
        const name = `${vw}${p.replace(/[/?=&]+/g, '_') || '_home'}`.slice(0, 80)
        await page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {})
        report.push({ vw, page: p, issues: [...new Set(issues)] })
        await page.close()
      }
      await ctx.close()
    }
  }
  // Click paths, the way a person moves around: sidebar, phone tab bar, and
  // every Settings row (a direct page load can work while a click doesn't).
  for (const [vw, size, navSel] of [['laptop', { width: 1440, height: 900 }, '.sidebar .side-link'], ['phone', { width: 390, height: 844 }, '.bottom-nav button']]) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: 'dark' })
    await ctx.addCookies([{ name: 'aa_session', value: token, url: API }])
    const page = await ctx.newPage()
    const issues = []
    page.on('pageerror', (e) => issues.push(`JS crash on ${new URL(page.url()).pathname}: ${e.message.split('\n')[0]}`))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push(`console on ${new URL(page.url()).pathname}: ${m.text().slice(0, 160)}`) })
    await page.goto(`${API}/`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {})
    const navCount = await page.locator(navSel).count()
    for (let i = 0; i < navCount; i++) {
      const btn = page.locator(navSel).nth(i)
      const label = (await btn.innerText().catch(() => '')).split('\n')[0] || (await btn.getAttribute('aria-label')) || `#${i}`
      const before = page.url()
      await btn.click({ timeout: 5_000 }).catch((e) => issues.push(`can't click nav "${label}": ${e.message.split('\n')[0]}`))
      await page.waitForURL((u) => u.toString() !== before, { timeout: 8_000 }).catch(() => { if (i > 0) issues.push(`nav "${label}" didn't navigate (still ${new URL(page.url()).pathname})`) })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      if (await page.locator('text=/Application error|This page couldn.t load/').count()) issues.push(`nav "${label}" shows an error screen`)
    }
    // Settings: open the hub by clicking, then every row.
    await page.goto(`${API}/`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {})
    await page.locator(navSel).filter({ hasText: /Settings/ }).first().click().catch(() => {})
    if (vw === 'phone') await page.locator('.bottom-nav button[aria-label="Settings"], .bottom-nav button:has-text("Settings")').first().click().catch(() => {})
    await page.waitForURL(/\/settings$/, { timeout: 8_000 }).catch(() => issues.push(`clicking Settings went to ${new URL(page.url()).pathname}`))
    const rows = await page.locator('.hub-row').count()
    if (!rows) issues.push('Settings hub shows no rows')
    for (let i = 0; i < rows; i++) {
      const row = page.locator('.hub-row').nth(i)
      const label = (await row.locator('.hub-title').innerText().catch(() => `row ${i}`)).trim()
      await row.click({ timeout: 5_000 }).catch((e) => issues.push(`can't click "${label}": ${e.message.split('\n')[0]}`))
      await page.waitForURL(/\/settings\/.+/, { timeout: 8_000 }).catch(() => issues.push(`"${label}" didn't open (still ${new URL(page.url()).pathname})`))
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      if (await page.locator('text=/Application error|This page couldn.t load/').count()) issues.push(`"${label}" shows an error screen`)
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForURL(/\/settings$/, { timeout: 8_000 }).catch(() => page.goto(`${API}/settings`, { waitUntil: 'networkidle' }))
    }
    report.push({ vw, page: 'click paths (nav + every Settings row)', issues: [...new Set(issues)] })
    await ctx.close()
  }

  // Jobs filters: open a dropdown, pick an option, the list and the address follow.
  for (const [vw, size] of [['laptop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: process.env.AUDIT_SCHEME === 'light' ? 'light' : 'dark' })
    await ctx.addCookies([{ name: 'aa_session', value: token, url: API }])
    const page = await ctx.newPage()
    const issues = []
    page.on('pageerror', (e) => issues.push(`JS crash: ${e.message.split(String.fromCharCode(10))[0]}`))
    await page.goto(`${API}/jobs?view=all`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {})
    const sub = async () => (await page.locator('.page-head .ph-sub').innerText().catch(() => '')).trim()
    const before = await sub()
    if (vw === 'laptop') {
      await page.locator('.fl-btn', { hasText: 'Location' }).click().catch(() => issues.push('no Location filter button'))
      await sleep(600)
      await page.screenshot({ path: path.join(out, 'laptop_jobs_filter_open.png') }).catch(() => {})
      const opt = page.locator('.fl-pop .fl-opt').filter({ has: page.locator('input[type=checkbox]') }).nth(1)
      if (!(await opt.count())) issues.push('Location filter shows no options')
      await opt.click().catch(() => {})
      await page.waitForURL(/[?&](cities|countries)=/, { timeout: 8_000 }).catch(() => issues.push(`address didn't take the filter: ${page.url()}`))
      await page.waitForLoadState('networkidle').catch(() => {})
      await sleep(600)
      if ((await sub()) === before) issues.push(`list count didn't change after filtering (${before})`)
      if (!(await page.locator('.fl-chip').count())) issues.push('no active-filter chip')
      await page.keyboard.press('Escape')
      await page.screenshot({ path: path.join(out, 'laptop_jobs_filtered.png') }).catch(() => {})
      await page.locator('.fl-chips .link-btn', { hasText: 'Clear all' }).click().catch(() => issues.push('no Clear all'))
      await page.waitForLoadState('networkidle').catch(() => {})
      await sleep(600)
      if ((await sub()) !== before) issues.push(`Clear all didn't restore the list (${await sub()} vs ${before})`)
    } else {
      await page.locator('.fl-mobile').click().catch(() => issues.push('no Filters button on phone'))
      await sleep(500)
      await page.locator('.fl-sec summary', { hasText: 'Work mode' }).click().catch(() => {})
      await sleep(300)
      await page.screenshot({ path: path.join(out, 'phone_jobs_filter_sheet.png') }).catch(() => {})
      if (!(await page.locator('.fl-sheet').count())) issues.push('filter sheet did not open')
    }
    report.push({ vw, page: 'Jobs filters', issues })
    await ctx.close()
  }

  // Interactions: the Ctrl+K command palette and the theme switch.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
    await ctx.addCookies([{ name: 'aa_session', value: token, url: API }])
    const page = await ctx.newPage()
    const issues = []
    page.on('pageerror', (e) => issues.push(`JS crash: ${e.message.split('\n')[0]}`))
    await page.goto(`${API}/`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {})
    await page.keyboard.press('Control+k')
    if (!(await page.locator('.cmdk').isVisible().catch(() => false))) issues.push('Ctrl+K did not open the command palette')
    await page.keyboard.type('profile')
    await sleep(400)
    await page.screenshot({ path: path.join(out, 'laptop_command_palette.png') }).catch(() => {})
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/settings\/profile/, { timeout: 8_000 }).catch(() => issues.push(`palette Enter went to ${page.url()}`))
    await page.locator('.sidebar .theme-switch button[aria-label="Light"]').click().catch(() => issues.push('no theme switch in the sidebar'))
    await sleep(500) // the background fades between themes
    const theme = await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor])
    if (theme[0] !== 'light' || theme[1] !== 'rgb(238, 241, 244)') issues.push(`theme switch: ${theme.join(' / ')}`)
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'light') issues.push('theme choice not kept after reload')
    report.push({ vw: 'laptop', page: 'interactions (Ctrl+K, theme)', issues })
    await ctx.close()
  }

  const bad = report.filter((r) => r.issues.length)
  for (const r of bad) console.log(`✗ [${r.vw}] ${r.page}\n    ${r.issues.join('\n    ')}`)
  console.log(`\n${report.length - bad.length}/${report.length} page views clean. Screenshots: ${out}`)
  const errs = serverLog.split('\n').filter((l) => /error|unhandled|⨯/i.test(l) && !/autoapply\.db\] Storage/.test(l))
  if (errs.length) console.log(`\nServer log errors:\n  ${[...new Set(errs)].slice(0, 25).join('\n  ')}`)
} finally {
  await browser?.close().catch(() => {})
  srv.kill()
  await sleep(1000)
  try {
    fs.rmSync(data, { recursive: true, force: true })
  } catch {}
  setTimeout(() => process.exit(), 500)
}
