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
    "const s = await a.createSession(Number(u.id), true, { userAgent: 'page-audit' }); console.log('TOKEN=' + s.token); process.exit(0)"],
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
    for (const p of ['/signup', '/login', '/forgot']) preAuth.push(p)
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

  const pages = [
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
      const ctx = await browser.newContext({ viewport: size })
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
