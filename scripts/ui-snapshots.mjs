/**
 * Dev helper: boot the built app on a throwaway data dir with demo data and
 * screenshot the main career-flow pages at laptop and phone widths.
 *   node scripts/ui-snapshots.mjs <outDir>
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const out = process.argv[2] || path.join(os.tmpdir(), 'aa-ui')
fs.mkdirSync(out, { recursive: true })
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-ui-data-'))
fs.mkdirSync(path.join(data, 'seed'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'tests/fixtures/resume/base.tex'), path.join(data, 'seed', 'base_resume.tex'))
const PORT = 8960

const JD = 'Requirements\n0-2 years of experience with Java, Spring Boot, Docker, SQL and REST APIs. Build payment services, write unit tests, review code.\nNice to have\nKafka, Kubernetes, AWS.'
const mock = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  if (req.url === '/careers') return res.end('<a href="/jobs/1">Backend Engineer I</a><a href="/jobs/2">Software Engineer, Payments</a><a href="/jobs/3">Senior Staff Engineer</a><a href="/jobs/4">ML Engineer Intern</a>')
  res.end(`<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"x","description":"${JD}","datePosted":"2026-11-06"}</script></head><body></body></html>`)
}).listen(8961, '127.0.0.1')

const srv = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: ROOT, env: { ...process.env, AUTO_APPLY_DATA_DIR: data }, stdio: 'ignore' })
const API = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${API}/api/health`)).ok) break } catch {} await sleep(500) }
// Screens before an account exists (sign-up) are captured first.
const browserPre = await chromium.launch()
for (const [vw, size] of [['laptop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browserPre.newContext({ viewport: size, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(`${API}/`, { waitUntil: 'networkidle' }).catch(() => {})
  await sleep(1200)
  await page.screenshot({ path: path.join(out, `${vw}-auth-signup.png`) })
  await ctx.close()
}
await browserPre.close()
const su = await fetch(`${API}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Alex Morgan', email: 'alex.morgan@example.com', password: 'demo-pass-1' }) })
const token = (await su.json()).token
const sessionCookie = { name: 'aa_session', value: token, url: API }
const call = async (m, p, b) => (await fetch(`${API}${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: b ? JSON.stringify(b) : undefined })).json()
const cur = await call('GET', '/api/settings')
await call('PUT', '/api/settings', { profile: { ...cur.profile, full_name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '+91 9000000000', current_location: 'Chennai, India' }, job_prefs: { ...cur.job_prefs, target_roles: ['Software Engineer', 'Backend Engineer'], locations: ['Chennai', 'Bengaluru'] }, ai: { ...cur.ai, provider: 'manual' } })
const c = await call('POST', '/api/companies', { name: 'MockPay', career_url: 'http://127.0.0.1:8961/careers' })
await call('POST', `/api/companies/${c.id}/scan`)
await sleep(9000) // worker fetches JDs
const jobs = await call('GET', '/api/jobs?view=all')
const job = jobs.items.find((j) => j.title === 'Backend Engineer I') || jobs.items[0]
const { session_id } = await call('POST', `/api/jobs/${job.id}/apply`)

const browser = await chromium.launch()
const shots = [
  ['jobs', '/jobs'], ['apply', `/apply/${session_id}`], ['settings', '/settings'], ['setup', '/settings/setup'],
  ['prefs', '/settings/preferences'], ['resume-issues', '/settings/resume?tab=issues'], ['answers', '/settings/answers'], ['tracker', '/tracker'], ['security', '/settings/security'],
]
for (const [vw, size] of [['laptop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
  const anon = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
  const ap = await anon.newPage()
  for (const [name, url] of [['auth-login', '/login'], ['auth-forgot', '/forgot']]) {
    await ap.goto(`${API}${url}`, { waitUntil: 'networkidle' }).catch(() => {})
    await sleep(1200)
    await ap.screenshot({ path: path.join(out, `${vw}-${name}.png`) })
  }
  await anon.close()
  await ctx.addCookies([sessionCookie])
  const page = await ctx.newPage()
  for (const [name, url] of shots) {
    if (vw === 'phone' && !['jobs', 'apply', 'resume-issues', 'settings', 'security'].includes(name)) continue
    await page.goto(`${API}${url}`, { waitUntil: 'networkidle' }).catch(() => {})
    await sleep(name === 'apply' ? 4000 : 1500)
    await page.screenshot({ path: path.join(out, `${vw}-${name}.png`), fullPage: false })
  }
  await ctx.close()
}
await browser.close()
srv.kill()
mock.close()
console.log('screenshots in', out)
process.exit(0)
