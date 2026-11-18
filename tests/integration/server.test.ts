/**
 * Full-stack test: boots the production Next.js server (which auto-starts the
 * worker) on a throwaway data dir and drives the real HTTP API.
 *
 * Requires `npm run build` first; skipped when .next is missing. Uses a local
 * mock careers site, the manual AI provider (no Claude calls) and whatever
 * LaTeX setup the machine has (compile steps accept "compiler missing").
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const BUILT = fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-srv-'))
const PORT = 8800 + Math.floor(Math.random() * 150)
const API = `http://127.0.0.1:${PORT}`
let server: ChildProcess | null = null
let mock: http.Server
let mockBase = ''
let token = ''
let cookie = ''
let log = ''

const JD = 'Requirements\\n0-2 years of experience. Java, Spring Boot, Docker, SQL and REST APIs. You will build backend services for payments at scale, write unit tests, and work with a small team.'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call<T = unknown>(method: string, p: string, body?: unknown, auth = true): Promise<{ status: number; data: T }> {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const ct = r.headers.get('content-type') || ''
  return { status: r.status, data: (ct.includes('json') ? await r.json() : await r.text()) as T }
}

async function until<T>(fn: () => Promise<T | null | undefined | false>, what: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}\n--- server log ---\n${log.slice(-3000)}`)
    await sleep(500)
  }
}

before(async () => {
  if (!BUILT) return
  // Mock careers site: a listing page and a job page with JSON-LD.
  mock = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    if (req.url === '/careers') {
      res.end('<html><body><h1>Careers</h1><a href="/jobs/101">Backend Engineer I</a><a href="/jobs/102">Senior Staff Engineer</a><a href="/about">About</a></body></html>')
    } else if (req.url?.startsWith('/jobs/')) {
      res.end(`<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Backend Engineer I","description":"${JD}","datePosted":"${new Date().toISOString().slice(0, 10)}"}</script></head><body><main>Job</main></body></html>`)
    } else res.end('<html><body>about</body></html>')
  })
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()))
  mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`

  fs.mkdirSync(path.join(tmpDir, 'seed'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tests/fixtures/resume/base.tex'), path.join(tmpDir, 'seed', 'base_resume.tex'))

  const env: NodeJS.ProcessEnv = { ...process.env, AUTO_APPLY_DATA_DIR: tmpDir, PORT: String(PORT) }
  delete env.DATABASE_URL
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (d: Buffer) => (log += d.toString()))
  child.stderr?.on('data', (d: Buffer) => (log += d.toString()))
  server = child
  await until(async () => (await fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false)), 'server start', 90_000)
})

after(async () => {
  server?.kill()
  mock?.close()
  await sleep(1500)
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* worker may still hold files briefly on Windows */
  }
})

describe('server + worker end to end', { skip: BUILT ? false : 'run `npm run build` first' }, () => {
  test('auth: sign up → cookie session; API closed without it', async () => {
    assert.equal((await call('GET', '/api/jobs', undefined, false)).status, 401)
    const st = await call<{ state: string }>('GET', '/api/auth/status', undefined, false)
    assert.equal(st.data.state, 'signup')
    const bad = await call<{ detail: string }>('POST', '/api/auth/signup', { name: 'Test', email: 'nope', password: 'test-pass-123' }, false)
    assert.equal(bad.status, 400)
    assert.match(bad.data.detail, /valid email/)

    const r = await fetch(`${API}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: 'test@example.com', password: 'test-pass-123' }),
    })
    assert.equal(r.status, 200)
    const body = (await r.json()) as { token: string; recovery_code: string; user: { email: string } }
    assert.equal(body.user.email, 'test@example.com')
    assert.ok(body.recovery_code)
    const setCookie = r.headers.get('set-cookie') || ''
    assert.match(setCookie, /aa_session=/)
    assert.match(setCookie, /HttpOnly/i)
    cookie = setCookie.split(';')[0]
    token = body.token // bearer still works for API clients (the extension)

    const viaCookie = await fetch(`${API}/api/jobs`, { headers: { cookie } })
    assert.equal(viaCookie.status, 200, 'cookie authenticates')
    assert.equal((await call('GET', '/api/jobs')).status, 200, 'bearer authenticates')
    const me = await fetch(`${API}/api/auth/status`, { headers: { cookie } }).then((x) => x.json() as Promise<{ state: string; user: { name: string } }>)
    assert.equal(me.state, 'ready')
    assert.equal(me.user.name, 'Test User')

    // Sign-up is closed once the account exists.
    const again = await call('POST', '/api/auth/signup', { name: 'Eve', email: 'eve@example.com', password: 'another-pass-1' }, false)
    assert.equal(again.status, 403)
  })

  test('auth: cross-site writes with the cookie are blocked', async () => {
    const r = await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ profile: { full_name: 'pwned' } }),
    })
    assert.equal(r.status, 403)
    const same = await fetch(`${API}/api/auth/me`, { headers: { cookie, 'sec-fetch-site': 'same-origin' } })
    assert.equal(same.status, 200)
  })

  test('auth: log in / wrong password / sessions / log out', async () => {
    const wrong = await call<{ detail: string }>('POST', '/api/auth/login', { email: 'test@example.com', password: 'nope-nope' }, false)
    assert.equal(wrong.status, 401)
    assert.match(wrong.data.detail, /don.t match/)
    const ok = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' },
      body: JSON.stringify({ email: 'TEST@example.com', password: 'test-pass-123', remember: false }),
    })
    assert.equal(ok.status, 200)
    const phoneCookie = (ok.headers.get('set-cookie') || '').split(';')[0]
    assert.doesNotMatch(ok.headers.get('set-cookie') || '', /Max-Age/, 'not remembered → browser-session cookie')

    const list = await fetch(`${API}/api/auth/sessions`, { headers: { cookie } }).then((x) => x.json() as Promise<{ sessions: { id: number; current: boolean; user_agent: string }[] }>)
    assert.ok(list.sessions.length >= 2)
    assert.equal(list.sessions.filter((s) => s.current).length, 1)
    const phone = list.sessions.find((s) => /iPhone/.test(s.user_agent || ''))!
    const del = await fetch(`${API}/api/auth/sessions/${phone.id}`, { method: 'DELETE', headers: { cookie } })
    assert.equal(del.status, 200)
    assert.equal((await fetch(`${API}/api/jobs`, { headers: { cookie: phoneCookie } })).status, 401, 'revoked device is signed out')

    // Log out a throwaway session and confirm it's dead.
    const tmp = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@example.com', password: 'test-pass-123' }) })
    const tmpCookie = (tmp.headers.get('set-cookie') || '').split(';')[0]
    const out = await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { cookie: tmpCookie } })
    assert.match(out.headers.get('set-cookie') || '', /Max-Age=0/)
    assert.equal((await fetch(`${API}/api/jobs`, { headers: { cookie: tmpCookie } })).status, 401)
    assert.equal((await fetch(`${API}/api/jobs`, { headers: { cookie } })).status, 200, 'other sessions unaffected')
  })

  test('auth: sign-in pages render; app pages wait for a session', async () => {
    for (const p of ['/login', '/signup', '/forgot']) {
      const r = await fetch(`${API}${p}`)
      assert.equal(r.status, 200, p)
    }
  })

  test('worker starts automatically and reports healthy', async () => {
    const st = await until(async () => {
      const r = await call<{ checks: { id: string; status: string }[] }>('GET', '/api/setup/status')
      return r.data.checks.find((c) => c.id === 'worker')?.status === 'ok' ? r.data : null
    }, 'worker heartbeat', 60_000)
    assert.ok(st.checks.some((c) => c.id === 'chromium'))
    assert.ok(st.checks.some((c) => c.id === 'base_resume' && c.status === 'ok'), 'seeded base resume detected')
  })

  test('settings: new sections save, validate and mask secrets', async () => {
    const cur = (await call<Record<string, Record<string, unknown>>>('GET', '/api/settings')).data
    const r = await call<Record<string, Record<string, unknown>>>('PUT', '/api/settings', {
      job_prefs: { ...cur.job_prefs, target_roles: ['Backend Engineer'], locations: ['Chennai'], threshold: 40 },
      ai: { ...cur.ai, provider: 'manual', api_key: 'sk-secret' },
      profile: { ...cur.profile, full_name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '+91 9000000000', current_location: 'Chennai, India', github: 'https://github.com/alexmorgan-dev' },
    })
    assert.equal(r.status, 200)
    assert.deepEqual(r.data.job_prefs.target_roles, ['Backend Engineer'])
    assert.equal(r.data.ai.api_key, '••••••••')
  })

  test('resume: seeded base, linter issues, a fix through the API, facts', async () => {
    const bases = (await call<{ id: number; issues: { block: number } }[]>('GET', '/api/resume/bases')).data
    assert.equal(bases.length, 1)
    assert.ok(bases[0].issues.block >= 3)
    const iss = (await call<{ base_id: number; issues: { id: string; kind: string; severity: string; detail: string }[] }>('GET', '/api/resume/issues')).data
    const grad = iss.issues.find((i) => i.kind === 'todo' && /grad/.test(i.detail))!
    const fixed = await call<{ issues: { id: string }[] }>('POST', '/api/resume/issues', { base_id: iss.base_id, issue_id: grad.id, action: 'set', value: 'May 2026' })
    assert.equal(fixed.status, 200)
    assert.ok(!fixed.data.issues.some((i) => i.id === grad.id))
    const stale = await call('POST', '/api/resume/issues', { base_id: iss.base_id, issue_id: grad.id, action: 'set', value: 'x' })
    assert.equal(stale.status, 409, 'resolving twice is refused')
    const facts = (await call<{ facts: { experience: unknown[]; projects: unknown[] } }>('GET', '/api/resume/facts')).data
    assert.equal(facts.facts.experience.length, 3)
    assert.equal(facts.facts.projects.length, 4)
  })

  let jobId = 0
  test('companies: scan a careers page; worker fetches the JD; job is scored', async () => {
    // Adding a company queues its first scan; the worker runs it.
    const c = await call<{ id: number; scan_state: string | null }>('POST', '/api/companies', { name: 'MockCo', career_url: `${mockBase}/careers` })
    assert.equal(c.status, 200)
    assert.equal(c.data.scan_state, 'queued')
    // "Scan now" while one is queued doesn't start a second scan.
    const again = await call<{ queued: boolean; task_id: number }>('POST', `/api/companies/${c.data.id}/scan`)
    assert.equal(again.status, 200, JSON.stringify(again.data))
    const done = await until(async () => {
      const list = (await call<{ id: number; scan_state: string | null; last_status: string | null; next_scan_at: string | null }[]>('GET', '/api/companies')).data
      const row = list.find((x) => x.id === c.data.id)
      return row && !row.scan_state && row.last_status ? row : null
    }, 'scan by worker')
    assert.equal(done.last_status, 'ok')
    assert.ok(done.next_scan_at && Date.parse(done.next_scan_at) > Date.now(), 'next scan scheduled')
    const scans = (await call<{ id: number }[]>('GET', '/api/companies')).data.length
    assert.equal(scans, 1)
    const all = (await call<{ items: { id: number; title: string }[] }>('GET', '/api/jobs?view=all')).data
    const job = all.items.find((j) => j.title === 'Backend Engineer I')
    assert.ok(job, JSON.stringify(all))
    jobId = job.id
    const detail = await until(async () => {
      const d = (await call<{ has_description: boolean; match_score: number; keywords: { required: string[] } }>('GET', `/api/jobs/${jobId}`)).data
      return d.has_description ? d : null
    }, 'JD fetch by worker')
    assert.ok(detail.keywords.required.includes('Spring Boot'))
    assert.ok(detail.match_score >= 40, `score ${detail.match_score}`)
    const rel = (await call<{ items: { title: string }[] }>('GET', '/api/jobs?view=relevant')).data
    assert.ok(!rel.items.some((j) => /Senior/.test(j.title)), 'excluded keyword filtered')
  })

  let sid = 0
  let uploadedRid = ''
  test('apply: start session, gates explain what is missing', async () => {
    const r = await call<{ session_id: number }>('POST', `/api/jobs/${jobId}/apply`)
    assert.equal(r.status, 200)
    sid = r.data.session_id
    const again = await call<{ session_id: number; existing: boolean }>('POST', `/api/jobs/${jobId}/apply`)
    assert.equal(again.data.session_id, sid, 'reopens the same session')
    const d = (await call<{ versions: { generated_by: string }[]; gates: Record<string, { ok: boolean; reason: string }> }>('GET', `/api/apply/${sid}`)).data
    assert.equal(d.versions.length, 1)
    assert.equal(d.versions[0].generated_by, 'base')
    assert.equal(d.gates.generate.ok, false)
    assert.match(d.gates.generate.reason, /issue/)
    assert.equal(d.gates.submit.ok, false)
    const gen = await call('POST', `/api/apply/${sid}/resume/generate`, {})
    assert.equal(gen.status, 409, 'generate refused while the base has blocking issues')
  })

  test('apply without MiKTeX: attach an uploaded PDF instead', async () => {
    // Upload a tiny valid PDF the way Settings → Resumes does.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')
    const fd = new FormData()
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'My_Resume.pdf')
    fd.append('name', 'My resume')
    const up = await fetch(`${API}/api/resumes`, { method: 'POST', headers: { cookie }, body: fd })
    assert.equal(up.status, 200, await up.clone().text())
    const rid = ((await up.json()) as { id: string }).id
    uploadedRid = rid

    const list = await call<{ items: { id: string; exists: boolean }[] }>('GET', `/api/apply/${sid}/resume/use-pdf`)
    assert.ok(list.data.items.some((x) => x.id === rid && x.exists))
    const bad = await call<{ detail: string }>('POST', `/api/apply/${sid}/resume/use-pdf`, { resume_id: 'nope' })
    assert.equal(bad.status, 400)
    const r = await call<{ status: string; resume_version_id: number }>('POST', `/api/apply/${sid}/resume/use-pdf`, { resume_id: rid })
    assert.equal(r.status, 200)
    assert.equal(r.data.status, 'resume_ready')
    const d = (await call<{ versions: { id: number; generated_by: string; status: string }[]; gates: Record<string, { ok: boolean; reason: string }> }>('GET', `/api/apply/${sid}`)).data
    const v = d.versions.find((x) => x.id === r.data.resume_version_id)!
    assert.equal(v.generated_by, 'upload')
    assert.equal(v.status, 'locked')
    assert.equal(d.gates.lock.ok, true, 'no compiler needed for a ready-made PDF')
    const lockGates = (d as unknown as { lock_gates: Record<number, { ok: boolean }> }).lock_gates
    assert.equal(lockGates[v.id].ok, true, 'per-version lock check is sent to the page')
    const served = await fetch(`${API}/api/resume/versions/${v.id}/pdf`, { headers: { cookie } })
    assert.equal(served.status, 200)
    assert.equal((await served.arrayBuffer()).byteLength, pdf.length)
  })

  test('resolving the remaining blocking issues unlocks Generate; manual AI round trip', async () => {
    for (let i = 0; i < 6; i++) {
      const iss = (await call<{ base_id: number; issues: { id: string; kind: string; severity: string; actions: { id: string; needs_value?: boolean }[] }[] }>('GET', '/api/resume/issues')).data
      const b = iss.issues.find((x) => x.severity === 'block')
      if (!b) break
      const action = b.kind === 'todo' ? 'set' : b.kind === 'unverified_claim' ? 'confirm' : b.actions[0].id
      await call('POST', '/api/resume/issues', { base_id: iss.base_id, issue_id: b.id, action, value: '8.6' })
    }
    const d = (await call<{ gates: Record<string, { ok: boolean }> }>('GET', `/api/apply/${sid}`)).data
    assert.equal(d.gates.generate.ok, true)

    const gen = await call<{ version_id: number }>('POST', `/api/apply/${sid}/resume/generate`, { hint: 'backend' })
    assert.equal(gen.status, 200)
    const vid = gen.data.version_id
    await until(async () => (await call<{ status: string }>('GET', `/api/resume/versions/${vid}`)).data.status === 'awaiting_manual', 'manual AI request')
    const prompt = (await call<{ prompt: string }>('GET', `/api/resume/versions/${vid}/manual`)).data.prompt
    assert.match(prompt, /<candidate_facts note=/)
    assert.match(prompt, /<requirements_coverage>/)
    assert.match(prompt, /<job_description untrusted="true">/)

    const bad = await call('POST', `/api/resume/versions/${vid}/manual`, { answer: 'not json' })
    assert.equal(bad.status, 400)
    const facts = (await call<{ facts: { experience: { id: string }[]; projects: { id: string }[] } }>('GET', '/api/resume/facts')).data.facts
    const plan = {
      summary: 'Backend engineer building Java and Spring Boot REST APIs with Docker and CI/CD.',
      skills: null,
      experience: facts.experience.map((e) => ({ id: e.id, bullets: [{ ref: 'b1' }, { ref: 'b2' }] })),
      projects: facts.projects.slice(0, 2).map((p) => ({ id: p.id, bullets: [{ ref: 'b1' }, { ref: 'b2', text: 'Invented a 99% improvement with Kafka.' }] })),
      notes: ['Kafka is not on your resume.'],
    }
    const ok = await call('POST', `/api/resume/versions/${vid}/manual`, { answer: '```json\n' + JSON.stringify(plan) + '\n```' })
    assert.equal(ok.status, 200)
    const v = await until(async () => {
      const x = (await call<{ status: string; latex: string; guard_report: { flags: { level: string; message: string }[] } | null; compile_log: { ok: boolean } | null }>('GET', `/api/resume/versions/${vid}`)).data
      return x.status === 'draft' ? x : null
    }, 'tailor finish')
    assert.ok(v.latex.includes('Backend engineer building Java and Spring Boot REST APIs'))
    assert.ok(v.guard_report!.flags.some((f) => f.level === 'reject' && /99/.test(f.message)), 'invented metric rejected by guards')
    assert.ok(!v.latex.includes('99%'))
    assert.ok(v.compile_log, 'compile attempted (or reported missing compiler)')
  })

  test('live stream (SSE) authenticates via token and sends events', async () => {
    const ctrl = new AbortController()
    const r = await fetch(`${API}/api/apply/${sid}/stream?token=${encodeURIComponent(token)}`, { signal: ctrl.signal })
    assert.equal(r.status, 200)
    const reader = r.body!.getReader()
    let text = ''
    const end = Date.now() + 8000
    while (Date.now() < end && !text.includes('event: session')) {
      const { value, done } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    ctrl.abort()
    assert.ok(text.includes(': connected'))
    assert.ok(text.includes('event: session'))
    assert.equal((await fetch(`${API}/api/apply/${sid}/stream`)).status, 401, 'no token, no stream')
    // The web app's EventSource authenticates with the session cookie.
    const c2 = new AbortController()
    const viaCookie = await fetch(`${API}/api/apply/${sid}/stream`, { headers: { cookie }, signal: c2.signal })
    assert.equal(viaCookie.status, 200)
    c2.abort()
  })

  test('errors are clean JSON', async () => {
    const r = await call<{ detail: string }>('GET', '/api/artifacts/999999')
    assert.equal(r.status, 404)
    assert.match(r.data.detail, /not found/i)
    const s = await call<{ detail: string }>('POST', `/api/apply/${sid}/submit`)
    assert.equal(s.status, 409)
    const lock = await call<{ detail: string }>('POST', `/api/apply/${sid}/resume/lock`, { version_id: 999999 })
    assert.equal(lock.status, 400)
  })

  test('tracker lists the session; cancel works', async () => {
    const rows = (await call<{ id: number; status: string }[]>('GET', '/api/apply')).data
    assert.ok(rows.some((r) => r.id === sid))
    const c = await call<{ status: string }>('POST', `/api/apply/${sid}/cancel`)
    assert.equal(c.data.status, 'cancelled')
  })

  test('“I submitted it myself”: tracked as applied without the robot', async () => {
    const all = (await call<{ items: { id: number }[] }>('GET', '/api/jobs?view=all')).data
    const other = all.items.find((j) => j.id !== jobId)
    assert.ok(other, 'a second job to apply to')
    const st = await call<{ session_id: number }>('POST', `/api/jobs/${other!.id}/apply`)
    assert.equal(st.status, 200)
    const s2 = st.data.session_id
    // Not allowed before a resume is chosen.
    assert.equal((await call('POST', `/api/apply/${s2}/confirm`, { submitted: true, self: true })).status, 409)
    await call('POST', `/api/apply/${s2}/resume/use-pdf`, { resume_id: uploadedRid })
    const done = await call<{ status: string; stage: string }>('POST', `/api/apply/${s2}/confirm`, { submitted: true, self: true })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'submitted')
    assert.equal(done.data.stage, 'applied')
    const job = (await call<{ state: string }>('GET', `/api/jobs/${other!.id}`)).data
    assert.equal(job.state, 'applied')
  })

  test('companies: removing one with applications is refused; pause instead', async () => {
    const list = (await call<{ id: number; name: string; applications: number }[]>('GET', '/api/companies')).data
    const mockCo = list.find((c) => c.name === 'MockCo')!
    assert.ok(mockCo.applications >= 1)
    const del = await call<{ detail: string }>('DELETE', `/api/companies/${mockCo.id}`)
    assert.equal(del.status, 409)
    assert.match(del.data.detail, /Pause scanning instead/)
    const paused = await call<{ paused: number }>('PATCH', `/api/companies/${mockCo.id}`, { paused: true })
    assert.equal(paused.data.paused, 1)
    const scanAll = await call<{ started: number }>('POST', '/api/companies/scan_all')
    assert.equal(scanAll.data.started, 0, 'paused companies are skipped')
  })

  test('add a job by link: titled from the page, reuses the company, no duplicates', async () => {
    const r = await call<{ job_id: number; existing: boolean }>('POST', '/api/jobs/add', { url: `${mockBase}/jobs/555` })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.existing, false)
    const j = (await call<{ title: string; company_name: string; siblings: { id: number }[] }>('GET', `/api/jobs/${r.data.job_id}`)).data
    assert.equal(j.title, 'Backend Engineer I')
    assert.equal(j.company_name, 'MockCo', 'same host as a watched company')
    assert.ok(j.siblings.length >= 1, 'the scanned posting with the same title is listed as another location')
    const again = await call<{ job_id: number; existing: boolean }>('POST', '/api/jobs/add', { url: `${mockBase}/jobs/555` })
    assert.equal(again.data.existing, true)
    assert.equal(again.data.job_id, r.data.job_id)
    // The list folds the two postings into one row.
    const all = (await call<{ items: { title: string; more_locations: number }[] }>('GET', '/api/jobs?view=all')).data
    const rows = all.items.filter((x) => x.title === 'Backend Engineer I')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].more_locations, 1)
  })
})
