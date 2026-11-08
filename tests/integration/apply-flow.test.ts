/**
 * End-to-end autofill against local mock application forms, in a real
 * (headless) Chromium. Never touches real job sites.
 *
 *   single page: fill → needs you (attestation + open question) → answer →
 *                reviewing → submit → confirmation → submitted
 *   multi-step:  page 1 → Next → page 2 → submit
 *   sign-in wall → blocked
 *   validation error after submit → unconfirmed with the form's message
 *
 * Skips automatically when Playwright's Chromium isn't installed.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-e2e-'))
process.env.AUTO_APPLY_DATA_DIR = tmpDir
delete process.env.DATABASE_URL

const { playwrightChromiumPath } = await import('../../lib/setup/tools.ts')
const HAVE_BROWSER = !!playwrightChromiumPath()

const settings = await import('../../lib/server/settings.ts')
const db = await import('../../lib/server/db.ts')
const sessions = await import('../../lib/apply/sessions.ts')
const store = await import('../../lib/resume/store.ts')
const executor = await import('../../lib/apply/executor.ts')
const browser = await import('../../lib/apply/browser.ts')
const learn = await import('../../lib/apply/learn.ts')
const jobs = await import('../../lib/jobs/store.ts')

// ---------------------------------------------------------------- mock ATS

const received: { path: string; body: string }[] = []

const SINGLE = `<!doctype html><html><body>
<h1>Backend Engineer</h1>
<form id="application-form" method="post" action="/submit" enctype="multipart/form-data">
  <label for="first_name">First Name *</label><input id="first_name" name="first_name" required>
  <label for="last_name">Last Name *</label><input id="last_name" name="last_name" required>
  <label for="email">Email *</label><input id="email" name="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
  <label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required>
  <label for="li">LinkedIn Profile</label><input id="li" name="linkedin">
  <label for="auth">Are you legally authorized to work in India? *</label>
  <select id="auth" name="auth" required><option value="">Select...</option><option>Yes</option><option>No</option></select>
  <fieldset><legend>Gender</legend>
    <label><input type="radio" name="gender" value="m">Male</label>
    <label><input type="radio" name="gender" value="f">Female</label>
    <label><input type="radio" name="gender" value="d">Decline To Self Identify</label>
  </fieldset>
  <label for="why">Why do you want to join Acme? *</label><textarea id="why" name="why" required></textarea>
  <label><input type="checkbox" id="cert" name="cert" required> I certify that the information provided is true and complete *</label>
  <button type="submit">Submit application</button>
</form></body></html>`

const STEP1 = `<!doctype html><html><body><form method="post" action="/step2">
  <label for="fn">First name *</label><input id="fn" name="fn" required>
  <label for="em">E-mail *</label><input id="em" name="em" required>
  <button type="submit">Next</button></form></body></html>`
const STEP2 = `<!doctype html><html><body><form method="post" action="/submit">
  <label for="np">Notice period *</label><input id="np" name="np" required>
  <button type="submit">Submit</button></form></body></html>`
const LOGIN = `<!doctype html><html><body><h1>Sign in</h1><form>
  <label for="u">Email</label><input id="u" name="u"><label for="p">Password</label><input id="p" type="password" name="p">
  <button>Sign in</button></form></body></html>`
const INVALID = `<!doctype html><html><body><form method="post" action="/invalid-submit">
  <label for="a">Full name *</label><input id="a" name="a" required>
  <button type="submit">Submit application</button></form></body></html>`
const THANKS = '<!doctype html><html><body><h1>Thank you for applying!</h1><p>We have received your application.</p></body></html>'
const INVALID_AGAIN = `<!doctype html><html><body><form method="post" action="/invalid-submit">
  <div role="alert">Please upload a resume in PDF format</div>
  <label for="a">Full name *</label><input id="a" name="a" required>
  <button type="submit">Submit application</button></form></body></html>`

let server: http.Server
let base = ''

before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (html: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      }
      if (req.method === 'POST') received.push({ path: req.url || '', body })
      if (req.url === '/job/single') return send(SINGLE)
      if (req.url === '/job/multi') return send(STEP1)
      if (req.url === '/step2') return send(STEP2)
      if (req.url === '/job/login') return send(LOGIN)
      if (req.url === '/job/invalid') return send(INVALID)
      if (req.url === '/invalid-submit') return send(INVALID_AGAIN)
      if (req.url === '/submit') return send(THANKS)
      res.writeHead(404)
      res.end('not found')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const s = settings.load()
  settings.save({
    profile: { ...s.profile, full_name: 'Alex Morgan', email: 'alex@example.com', phone: '+91 9000000000', linkedin: 'https://linkedin.com/in/alex', current_location: 'Chennai, India' },
    apply_answers: { ...s.apply_answers, authorized_india: 'Yes', notice_period: '30 days', relocation: 'Yes' },
    ai: { ...s.ai, provider: 'manual' }, // no real AI calls in tests
    apply_automation: { ...s.apply_automation, headless: true, typing_delay_ms: 0 },
  })
})

after(async () => {
  await browser.closeAll()
  server?.close()
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* Windows keeps the DB locked */
  }
})

/** A job + session with a locked (fake) PDF, ready to fill. */
async function readySession(jobPath: string): Promise<number> {
  const c = (await db.addCompany(`Acme ${jobPath}`, `${base}${jobPath}-careers-${Math.random().toString(36).slice(2)}`))!
  const sync = await db.syncCompanyJobs(c.id, [{ title: 'Backend Engineer', url: `${base}${jobPath}`, location: 'Chennai', matched: true, match_reason: null, description_text: 'Java Spring Boot' }])
  const jobId = sync.new_ids[0]
  const sid = await sessions.createSession({ job_id: jobId, ats_type: 'custom', apply_url: `${base}${jobPath}`, jd_snapshot: 'Java' })
  const b = (await store.getDefaultBase()) ?? (await store.createBase('Base', '\\documentclass{article}\\begin{document}x\\end{document}', true))
  const vid = await store.createVersion({ base_id: b.id, job_id: jobId, session_id: sid, latex: b.latex, generated_by: 'base', status: 'locked' })
  const pdf = path.join(tmpDir, `v${vid}.pdf`)
  fs.writeFileSync(pdf, '%PDF-1.4\n%fake test pdf\n')
  await store.updateVersion(vid, { pdf_path: pdf, compile_log: { ok: true, errors: [] } })
  await sessions.setStatus(sid, 'resume_ready', { resume_version_id: vid })
  return sid
}

const answerFor = (plan: NonNullable<Awaited<ReturnType<typeof sessions.getSession>>>['fill_plan'], labelRe: RegExp) => {
  const f = plan!.fields.find((x) => labelRe.test(x.label))
  assert.ok(f, `field ${labelRe}`)
  return { f, a: plan!.answers[f.id] }
}

describe('autofill end to end (mock ATS)', { skip: HAVE_BROWSER ? false : 'Playwright Chromium not installed' }, () => {
  test('single-page form: fill, answer what needs you, submit, confirm', async () => {
    const sid = await readySession('/job/single')
    await executor.runFill(sid)
    let s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'needs_input', s.error ?? '')
    const plan = s.fill_plan!
    assert.equal(answerFor(plan, /First Name/).a.value, 'Alex')
    assert.equal(answerFor(plan, /Last Name/).a.value, 'Morgan')
    assert.equal(answerFor(plan, /Email/).a.filled, true)
    assert.match(String(answerFor(plan, /Resume/).a.value), /Alex_Morgan_Resume\.pdf$/)
    assert.equal(answerFor(plan, /authorized/).a.value, 'Yes')
    assert.equal(answerFor(plan, /Gender/).a.value, 'Decline To Self Identify')
    const cert = answerFor(plan, /I certify/)
    assert.equal(cert.a.needs_you, true, 'attestation must wait for you')
    const why = answerFor(plan, /Why do you want/)
    assert.equal(why.a.needs_you, true, 'manual AI mode: open question needs you')

    // Screenshots were taken.
    assert.ok((await sessions.listArtifacts(sid)).some((a) => a.kind === 'filled'))

    await executor.runAnswers(sid, { [cert.f.id]: true, [why.f.id]: 'I build backend services in Java and want to work on payments.' }, true)
    s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'reviewing', s.error ?? '')

    await executor.runSubmit(sid)
    s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'submitted', s.error ?? '')
    assert.equal(s.stage, 'applied')
    assert.equal((await jobs.getJob(s.job_id))!.state, 'applied')

    const post = received.find((r) => r.path === '/submit')!
    assert.ok(post, 'form was posted')
    for (const v of ['Alex', 'Morgan', 'alex@example.com', 'Alex_Morgan_Resume.pdf', 'Yes', 'payments']) assert.ok(post.body.includes(v), `posted ${v}`)

    // The typed answer was learned for next time.
    assert.ok((await learn.listBank()).some((e) => /why do you want to join acme/.test(e.question_norm)))
    const types = (await sessions.eventsSince(sid)).map((e) => e.type)
    for (const t of ['fill.started', 'fill.done', 'answers.updated', 'submit.clicked', 'submit.confirmed']) assert.ok(types.includes(t), t)
  })

  test('multi-step form: fills page 1, moves on, fills page 2, submits', async () => {
    const sid = await readySession('/job/multi')
    await executor.runFill(sid)
    let s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'reviewing', JSON.stringify(s.fill_plan?.answers))
    assert.equal(s.fill_plan!.step, 1)
    assert.ok(s.fill_plan!.final_step_reached)
    assert.equal(answerFor(s.fill_plan, /Notice period/).a.value, '30 days')
    assert.ok(received.some((r) => r.path === '/step2' && r.body.includes('Alex')))
    await executor.runSubmit(sid)
    s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'submitted')
  })

  test('sign-in wall is reported as blocked', async () => {
    const sid = await readySession('/job/login')
    await executor.runFill(sid)
    const s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'blocked')
    assert.match(s.error ?? '', /sign in/i)
  })

  test('form validation error after submit → unconfirmed with the message', async () => {
    const sid = await readySession('/job/invalid')
    await executor.runFill(sid)
    let s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'reviewing', s.error ?? '')
    await executor.runSubmit(sid)
    s = (await sessions.getSession(sid))!
    assert.equal(s.status, 'unconfirmed')
    assert.match(s.error ?? '', /upload a resume/i)
  })

  test('navigation outside the job site is blocked', async () => {
    const sid = await readySession('/job/single')
    const page = await browser.newPageFor(sid, `${base}/job/single`)
    const r = await page.goto('https://example.org/').catch((e: Error) => e)
    assert.ok(r instanceof Error, 'navigation to an unrelated site must fail')
    await browser.closePage(sid)
  })
})
