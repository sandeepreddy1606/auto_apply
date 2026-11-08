/**
 * Tests for the database-backed parts of the career flow, against a throwaway
 * SQLite data dir: migrations, the task queue, settings sections, resume
 * bases/history/versions, apply sessions + state machine, the answer bank and
 * job listing/rescoring.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-career-'))
process.env.AUTO_APPLY_DATA_DIR = tmpDir
delete process.env.DATABASE_URL

const db = await import('../lib/server/db.ts')
const queue = await import('../lib/tasks/queue.ts')
const settings = await import('../lib/server/settings.ts')
const store = await import('../lib/resume/store.ts')
const sessions = await import('../lib/apply/sessions.ts')
const learn = await import('../lib/apply/learn.ts')
const jobs = await import('../lib/jobs/store.ts')
const { parseClaudeOutput, inputHash } = await import('../lib/llm/provider.ts')
const { resumeFileName } = await import('../lib/apply/executor.ts')
const { shrinkPlan, similarity } = await import('../lib/resume/tailor.ts')
const { buildFacts } = await import('../lib/resume/facts.ts')
const { parseResume } = await import('../lib/resume/latex/parse.ts')
const { identityPlan } = await import('../lib/resume/plan.ts')
const { analyzeJd } = await import('../lib/jobs/analyze.ts')
const { parseLatexLog } = await import('../lib/resume/compile.ts')
const { isAllowedHost } = await import('../lib/apply/browser.ts')
const { MIGRATION_COUNT } = await import('../lib/server/migrations.ts')

const BASE = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/resume/base.tex'), 'utf-8')

// Windows keeps the SQLite file locked while the process lives; cleanup is best effort.
after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* EBUSY on Windows */
  }
})

describe('migrations', () => {
  test('all migrations applied once and new columns exist', async () => {
    await db.listCompanies() // initialises the driver
    const rows = await db.sql.all('SELECT id FROM schema_migrations ORDER BY id')
    assert.equal(rows.length, MIGRATION_COUNT)
    const cols = (await db.sql.all('PRAGMA table_info(company_jobs)')).map((c) => c.name)
    for (const c of ['description_text', 'match_score', 'apply_url', 'ats_job_id']) assert.ok(cols.includes(c), c)
  })
})

describe('task queue', () => {
  test('enqueue → claim → complete; lanes are separate', async () => {
    const id = await queue.enqueue('jobs.fetch_jd', { job_id: 1 })
    const bid = await queue.enqueue('apply.fill', { session_id: 1 })
    assert.equal(await queue.claim('llm', 'w'), null)
    const t = await queue.claim('default', 'w')
    assert.equal(t?.id, id)
    assert.equal(t?.attempts, 1)
    assert.equal((await queue.claim('browser', 'w'))?.id, bid)
    await queue.complete(id, { ok: true })
    assert.equal((await queue.getTask(id))?.status, 'done')
    assert.deepEqual((await queue.getTask(id))?.result, { ok: true })
  })
  test('dedupe key returns the existing task', async () => {
    const a = await queue.enqueue('jobs.rescore', {}, { dedupeKey: 'r' })
    const b = await queue.enqueue('jobs.rescore', {}, { dedupeKey: 'r' })
    assert.equal(a, b)
  })
  test('failures back off, then fail permanently; browser tasks do not retry', async () => {
    const id = await queue.enqueue('companies.scan', { company_id: 9 }, { maxAttempts: 2 })
    let t = (await queue.claim('default', 'w'))!
    while (t.id !== id) t = (await queue.claim('default', 'w'))!
    assert.equal(await queue.fail(t, 'boom'), 'retry')
    assert.equal(await queue.claim('default', 'w'), null, 'not runnable during backoff')
    await db.sql.run('UPDATE tasks SET run_after = ? WHERE id = ?', [new Date(0).toISOString(), id])
    t = (await queue.claim('default', 'w'))!
    assert.equal(t.attempts, 2)
    assert.equal(await queue.fail(t, 'boom again'), 'failed')
    const bid = await queue.enqueue('apply.submit', { session_id: 2 })
    const bt = (await queue.claim('browser', 'w'))!
    assert.equal(bt.id, bid)
    assert.equal(await queue.fail(bt, 'x'), 'failed')
  })
  test('stuck tasks are reclaimed; orphans requeued (browser ones failed)', async () => {
    const id = await queue.enqueue('jobs.fetch_jd', { job_id: 3 })
    const t = (await queue.claim('default', 'w'))!
    assert.equal(t.id, id)
    await db.sql.run('UPDATE tasks SET locked_at = ? WHERE id = ?', [new Date(Date.now() - 3_600_000).toISOString(), id])
    assert.ok((await queue.reclaimStuck()) >= 1)
    assert.equal((await queue.getTask(id))?.status, 'queued')
    const b = await queue.enqueue('apply.fill', { session_id: 5 })
    await queue.claim('browser', 'w')
    await queue.requeueOrphans()
    assert.equal((await queue.getTask(b))?.status, 'failed')
  })
  test('kv store', async () => {
    await queue.kvSet('k', { a: 1 })
    await queue.kvSet('k', { a: 2 })
    assert.deepEqual((await queue.kvGet('k'))?.value, { a: 2 })
  })
})

describe('settings sections', () => {
  test('defaults present; sanitize clamps and cleans', () => {
    const s = settings.load()
    assert.equal(s.job_prefs.threshold, 55)
    assert.equal(s.ai.provider, 'claude-code')
    const saved = settings.save({
      job_prefs: { ...s.job_prefs, threshold: 500, target_roles: [' SDE ', 'sde', '', 'Backend Engineer'], seniority: ['intern', 'bogus'] as never },
      resume_prefs: { ...s.resume_prefs, max_pages: 9, filename_pattern: 'a/b:c' },
      ai: { ...s.ai, provider: 'evil' as never, model: 'sonnet; rm -rf' },
      apply_automation: { ...s.apply_automation, extra_domains: ['https://login.example.com/path', 'not a domain'] },
    })
    assert.equal(saved.job_prefs.threshold, 100)
    assert.deepEqual(saved.job_prefs.target_roles, ['SDE', 'Backend Engineer'])
    assert.deepEqual(saved.job_prefs.seniority, ['intern'])
    assert.equal(saved.resume_prefs.max_pages, 3)
    assert.equal(saved.resume_prefs.filename_pattern, 'abc.pdf')
    assert.equal(saved.ai.provider, 'claude-code')
    assert.equal(saved.ai.model, 'sonnetrm-rf')
    assert.deepEqual(saved.apply_automation.extra_domains, ['login.example.com'])
  })
  test('application answers mirror into the profile', () => {
    const s = settings.load()
    const saved = settings.save({ apply_answers: { ...s.apply_answers, notice_period: '30 days', expected_ctc: '12 LPA', relocation: 'Yes', always_ask: ['background_check', 'nope'] } })
    assert.equal(saved.profile.notice_period, '30 days')
    assert.equal(saved.profile.expected_ctc, '12 LPA')
    assert.equal(saved.profile.willing_to_relocate, 'Yes')
    assert.deepEqual(saved.apply_answers.always_ask, ['background_check'])
  })
})

describe('resume store', () => {
  test('seed import on first use', async () => {
    fs.mkdirSync(path.dirname(store.SEED_PATH), { recursive: true })
    fs.writeFileSync(store.SEED_PATH, BASE)
    const bases = await store.listBases()
    assert.equal(bases.length, 1)
    assert.equal(bases[0].is_default, 1)
    assert.equal(bases[0].latex, BASE)
    assert.equal((await store.listBases()).length, 1, 'seeded once')
  })
  test('edits keep history and undo restores', async () => {
    const b = (await store.getDefaultBase())!
    await store.updateBaseLatex(b.id, `${BASE}\n% edit`, 'test edit')
    assert.equal(await store.historyCount(b.id), 1)
    const u = await store.undoBase(b.id)
    assert.equal(u.ok, true)
    assert.equal((await store.getBase(b.id))!.latex, BASE)
    assert.equal((await store.undoBase(b.id)).ok, false)
  })
  test('overlay feeds the fact bank; default facts available', async () => {
    const b = (await store.getDefaultBase())!
    await store.saveOverlay(b.id, { extra_bullets: {}, inventory_extra: ['Kafka'], locked: [] })
    const f = await store.getDefaultFacts()
    assert.ok(f!.all_skills.includes('Kafka'))
    await store.addDismissed(b.id, 'x-1')
    assert.deepEqual(await store.getDismissed(b.id), ['x-1'])
  })
  test('versions round trip JSON columns', async () => {
    const b = (await store.getDefaultBase())!
    const vid = await store.createVersion({ base_id: b.id, latex: BASE, generated_by: 'base' })
    await store.updateVersion(vid, { compile_log: { ok: false, errors: [{ line: 3, message: 'x' }] }, status: 'draft' })
    const v = await store.getVersion(vid)
    assert.deepEqual(v?.compile_log, { ok: false, errors: [{ line: 3, message: 'x' }] })
    assert.equal(v?.generated_by, 'base')
  })
})

describe('jobs + sessions', () => {
  let jobId = 0
  test('scan sync stores descriptions and reports jobs needing a JD', async () => {
    const c = (await db.addCompany('Acme', 'https://boards.greenhouse.io/acme'))!
    const r = await db.syncCompanyJobs(c.id, [
      { title: 'Backend Engineer I', url: 'https://boards.greenhouse.io/acme/jobs/1', location: 'Chennai', matched: true, match_reason: null, description_html: '<p>Java</p>', description_text: 'Requirements\nJava, Spring Boot, Docker, 0-2 years', match_score: 80, match_breakdown: null },
      { title: 'Senior Staff Engineer', url: 'https://boards.greenhouse.io/acme/jobs/2', location: 'Remote', matched: false, match_reason: null },
    ])
    assert.equal(r.new, 2)
    assert.equal(r.needs_jd_ids.length, 1)
    jobId = r.new_ids[0]
    // A rescan without a description must not wipe the stored one.
    await db.syncCompanyJobs(c.id, [{ title: 'Backend Engineer I', url: 'https://boards.greenhouse.io/acme/jobs/1', location: 'Chennai', matched: true, match_reason: null }])
    const j = await jobs.getJob(jobId)
    assert.match(j!.description_text!, /Spring Boot/)
    assert.deepEqual(j!.keywords?.required.sort(), ['Docker', 'Java', 'Spring Boot'])
  })
  test('rescore + listing views', async () => {
    const s = settings.load()
    settings.save({ job_prefs: { ...s.job_prefs, target_roles: ['Backend Engineer'], seniority: ['intern', 'new_grad', 'junior'], threshold: 40 } })
    const n = await jobs.rescoreJobs()
    assert.ok(n >= 1)
    const rel = await jobs.listJobs({ view: 'relevant' })
    assert.ok(rel.items.some((j) => j.id === jobId))
    assert.ok(!rel.items.some((j) => j.title.startsWith('Senior')), 'excluded keyword filtered')
    const all = await jobs.listJobs({ view: 'all' })
    assert.equal(all.total, 1) // the senior one was deactivated by the second sync
    const prev = await jobs.previewRelevantCount({ threshold: 100 })
    assert.equal(prev.relevant, 0)
  })
  test('session state machine and events', async () => {
    const sid = await sessions.createSession({ job_id: jobId, ats_type: 'greenhouse', apply_url: 'https://boards.greenhouse.io/acme/jobs/1', jd_snapshot: 'x' })
    await assert.rejects(sessions.setStatus(sid, 'submitted'), /Can't go from created to submitted/)
    await sessions.setStatus(sid, 'resume_drafting')
    await sessions.setStatus(sid, 'resume_ready', { resume_version_id: 1 })
    await sessions.setStatus(sid, 'filling')
    await sessions.setStatus(sid, 'reviewing')
    const ev = await sessions.eventsSince(sid)
    assert.deepEqual(ev.map((e) => e.type), ['session.created', 'status.resume_drafting', 'status.resume_ready', 'status.filling', 'status.reviewing'])
    assert.equal((await sessions.eventsSince(sid, ev[2].id)).length, 2)
    const art = await sessions.addArtifact(sid, 'filled', Buffer.from('jpeg'), 0, 'jpg')
    assert.ok(fs.existsSync((await sessions.getArtifact(art))!.path))
    const list = await jobs.listJobs({ view: 'all' })
    assert.equal(list.items.find((j) => j.id === jobId)?.session_status, 'reviewing')
  })
  test('answer bank learns and lists', async () => {
    const f = { id: 's0f1', kind: 'text' as const, input_type: 'text', label: 'Favourite language?', name: 'q1', required: true, options: [], max_length: null, multiple: false, step: 0 }
    await learn.rememberAnswer(f, 'Java', 'greenhouse')
    await learn.rememberAnswer(f, 'Python', 'greenhouse')
    const bank = await learn.listBank()
    assert.equal(bank.length, 1)
    assert.equal(bank[0].answer, 'Python')
    assert.equal(bank[0].uses, 2)
    await learn.rememberMapping({ ...f, label: 'Profile link' }, 'https://linkedin.com/in/me', 'lever', { linkedin: 'https://linkedin.com/in/me' })
    assert.deepEqual(await learn.loadMappings('lever'), [{ field_sig: 'profile link|q1', profile_key: 'linkedin' }])
  })
})

describe('scan sync never closes open jobs by accident', () => {
  const job = (n: number) => ({ title: `Software Engineer ${n}`, url: `https://www.amazon.jobs/en/jobs/${n}/sde`, location: 'Bengaluru', matched: true, match_reason: null })
  const activeCount = async (cid: number) =>
    Number((await db.sql.one('SELECT COUNT(*) AS n FROM company_jobs WHERE company_id = ? AND active = 1', [cid]))?.n)

  test('search window: jobs that drop out stay open until stale', async () => {
    const c = (await db.addCompany('Amazon test', 'https://www.amazon.jobs/en/'))!
    await db.syncCompanyJobs(c.id, [1, 2, 3, 4].map(job), { windowed: true })
    const r = await db.syncCompanyJobs(c.id, [3, 4, 5].map(job), { windowed: true })
    assert.equal(r.gone, 0, 'jobs 1 and 2 left the search window but may still be open')
    assert.equal(await activeCount(c.id), 5)
    // Not seen for longer than the stale window → closed.
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString()
    await db.sql.run('UPDATE company_jobs SET last_seen_at = ? WHERE company_id = ? AND url LIKE ?', [old, c.id, '%/1/%'])
    const r2 = await db.syncCompanyJobs(c.id, [3, 4, 5].map(job), { windowed: true })
    assert.equal(r2.gone, 1)
  })

  test('a full board closes missing jobs, but a sudden partial scan does not', async () => {
    const c = (await db.addCompany('Board test', 'https://boards.greenhouse.io/boardtest'))!
    const many = Array.from({ length: 20 }, (_, i) => job(100 + i))
    await db.syncCompanyJobs(c.id, many)
    const normal = await db.syncCompanyJobs(c.id, many.slice(0, 18))
    assert.equal(normal.gone, 2, 'a normal rescan closes what disappeared')
    const partial = await db.syncCompanyJobs(c.id, many.slice(0, 3))
    assert.equal(partial.gone, 0, '3 of 18 looks like a hiccup, not 15 closures')
  })
})

describe('profile from resume', () => {
  test('derives contact, links, education and current role', async () => {
    const { profileFromResume } = await import('../lib/resume/profile-fill.ts')
    const p = profileFromResume(BASE)
    assert.equal(p.full_name, 'Alex Morgan', 'ALL CAPS name is title-cased')
    assert.equal(p.email, 'alex.morgan@example.com')
    assert.equal(p.phone, '9000000000')
    assert.match(p.linkedin ?? '', /^https:\/\/www\.linkedin\.com\/in\/alexmorgan-dev/)
    assert.match(p.github ?? '', /^https:\/\/github\.com\/alexmorgan-dev/)
    assert.ok(p.current_role && p.current_company, 'current job from the "Present" entry')
    assert.ok(p.college && p.degree)
    assert.equal(p.graduation_year, undefined, 'an unfinished date range ("2022 -- TODO") gives no graduation year')
  })

  test('fills only empty fields and never overwrites yours', async () => {
    const { fillProfileGaps } = await import('../lib/resume/profile-fill.ts')
    const s = settings.load()
    settings.save({ profile: { ...s.profile, full_name: 'My Own Name', email: '', phone: '' } })
    const filled = fillProfileGaps(BASE)
    const p = settings.load().profile
    assert.equal(p.full_name, 'My Own Name')
    assert.equal(p.email, 'alex.morgan@example.com')
    assert.ok(filled.includes('email') && !filled.includes('full_name'))
    assert.deepEqual(fillProfileGaps(BASE), [], 'second run has nothing left to fill')
  })
})

describe('no paid AI routes', () => {
  test('the claude CLI never sees API keys or cloud-billing settings', async () => {
    const { subscriptionOnlyEnv, PAID_ENV_VARS } = await import('../lib/llm/provider.ts')
    const env = subscriptionOnlyEnv({ PATH: '/bin', HOME: '/home/me', ANTHROPIC_API_KEY: 'sk-ant-x', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BASE_URL: 'https://proxy' } as unknown as NodeJS.ProcessEnv)
    for (const k of PAID_ENV_VARS) assert.equal(env[k], undefined, k)
    assert.equal(env.PATH, '/bin')
    assert.equal(env.HOME, '/home/me')
  })
})

describe('misc helpers', () => {
  test('claude -p output parsing', () => {
    const ok = parseClaudeOutput('{"type":"result","subtype":"success","is_error":false,"result":"done","structured_output":{"ok":true}}')
    assert.deepEqual(ok, { data: { ok: true }, isError: false, message: 'done' })
    const fenced = parseClaudeOutput(JSON.stringify({ type: 'result', is_error: false, result: 'Here:\n```json\n{"a":1}\n```' }))
    assert.deepEqual(fenced.data, { a: 1 })
    const err = parseClaudeOutput('{"type":"result","is_error":true,"result":"Claude AI usage limit reached"}')
    assert.equal(err.isError, true)
    assert.equal(parseClaudeOutput('garbage').isError, true)
  })
  test('cache key is stable', () => {
    const r = { purpose: 'p', system: 's', prompt: 'x', schema: { a: 1 } }
    assert.equal(inputHash(r), inputHash({ ...r }))
    assert.notEqual(inputHash(r), inputHash({ ...r, prompt: 'y' }))
  })
  test('resume file name pattern', () => {
    assert.equal(resumeFileName('{First}_{Last}_Resume.pdf', 'ALEX MORGAN'), 'Alex_Morgan_Resume.pdf')
    assert.equal(resumeFileName('{First}_{Last}_Resume.pdf', 'Madonna'), 'Madonna_Resume.pdf')
  })
  test('fit-to-page shrinks projects first, then older roles, never below the floor', () => {
    const facts = buildFacts(parseResume(BASE))
    const jd = analyzeJd('Backend Engineer', 'Java Spring Boot Docker')
    let plan = identityPlan(facts, 4)
    const sizes: number[] = []
    for (let i = 0; i < 60; i++) {
      const next = shrinkPlan(plan, facts, jd)
      if (!next) break
      plan = next
      sizes.push(plan.projects.reduce((n, p) => n + p.bullets.length, 0))
    }
    assert.ok(plan.projects.length >= 1)
    assert.ok(plan.experience.every((e) => e.bullets.length >= 2))
    assert.equal(plan.experience.length, 3)
    assert.ok(sizes[0] < 20)
  })
  test('similarity', () => {
    assert.equal(similarity(['java', 'sql'], ['java', 'sql']), 1)
    assert.equal(similarity(['java'], ['go']), 0)
  })
  test('latex log parsing', () => {
    const errs = parseLatexLog('./main.tex:42: Undefined control sequence.\n! Emergency stop.\n')
    assert.deepEqual(errs[0], { line: 42, message: 'Undefined control sequence.' })
    assert.ok(errs.some((e) => e.message === 'Emergency stop.'))
  })
  test('navigation allowlist', () => {
    assert.ok(isAllowedHost('job-boards.greenhouse.io', 'acme.com', []))
    assert.ok(isAllowedHost('careers.acme.com', 'jobs.acme.com', []))
    assert.ok(isAllowedHost('sso.corp.io', 'acme.com', ['corp.io']))
    assert.ok(!isAllowedHost('evil.example', 'acme.com', []))
  })
})
