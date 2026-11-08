/**
 * LIVE test: one real tailoring call through your local Claude Code CLI (uses a
 * little of your Claude Pro limit). Opt-in only:
 *
 *   AA_LIVE=1 node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs --test tests/live/tailor-live.test.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

const LIVE = process.env.AA_LIVE === '1'
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-live-'))
process.env.AUTO_APPLY_DATA_DIR = tmpDir
delete process.env.DATABASE_URL

describe('live Claude Code tailoring', { skip: LIVE ? false : 'set AA_LIVE=1 to run' }, () => {
  test('plan is valid JSON, passes guards, and renders into the template', { timeout: 300_000 }, async () => {
    const db = await import('../../lib/server/db.ts')
    const store = await import('../../lib/resume/store.ts')
    const { runTailor } = await import('../../lib/resume/tailor.ts')
    const { getVersion } = await import('../../lib/resume/store.ts')

    const latex = fs.readFileSync(path.join(import.meta.dirname, '../fixtures/resume/base.tex'), 'utf-8')
    const base = await store.createBase('Base', latex, true)
    const c = (await db.addCompany('LiveCo', 'https://example.com/careers-live'))!
    const sync = await db.syncCompanyJobs(c.id, [{
      title: 'Backend Software Engineer I',
      url: 'https://example.com/jobs/live-1',
      location: 'Bengaluru',
      matched: true,
      match_reason: null,
      description_text: 'About the role\nBuild payment APIs.\nRequirements\n- 0-2 years with Java and Spring Boot\n- REST APIs, SQL, Docker, CI/CD\n- Unit testing and code reviews\nNice to have\n- Kafka, Kubernetes, AWS',
    }])
    const vid = await store.createVersion({ base_id: base.id, job_id: sync.new_ids[0], latex, generated_by: 'llm', status: 'generating' })
    const t0 = Date.now()
    const r = await runTailor(vid)
    const v = (await getVersion(vid))!
    console.log(`[live] status=${r.status} in ${Math.round((Date.now() - t0) / 1000)}s; flags=${v.guard_report?.flags.length}; notes=${JSON.stringify(v.guard_report?.notes)}`)
    for (const f of v.guard_report?.flags ?? []) console.log(`[live] ${f.level} ${f.where}: ${f.message}`)
    assert.equal(r.status, 'draft', v.error ?? '')
    assert.ok(v.llm_plan, 'plan stored')
    assert.ok(v.latex.includes('\\begin{document}') && v.latex.trimEnd().endsWith('\\end{document}'))
    assert.ok(!/\bKafka\b/.test(v.latex.split('Technical Skills')[1]?.split('\\section')[0] ?? ''), 'no invented Kafka in skills')
    assert.ok(v.latex.includes('Hirola InfoTech Solutions'), 'every role kept')
    fs.writeFileSync(path.join(os.tmpdir(), 'aa-live-tailored.tex'), v.latex)
    console.log(`[live] tailored LaTeX written to ${path.join(os.tmpdir(), 'aa-live-tailored.tex')}`)
  })
})
