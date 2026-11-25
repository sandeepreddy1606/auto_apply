/**
 * Boots the background work: the periodic company-scan loop, a one-time
 * re-score when the job-description reader changes, and the worker.
 *
 * start() runs once per server process (from instrumentation.ts). The guard
 * below keeps dev-mode hot reloads from starting it twice.
 */
const STARTED = Symbol.for('autoapply.instrumentation.started')
type GlobalFlag = typeof globalThis & { [STARTED]?: boolean }

export async function start(): Promise<void> {
  const g = globalThis as GlobalFlag
  if (g[STARTED]) return
  g[STARTED] = true
  // Once per install: copy resume details (name, email, phone, links,
  // education, current role) into empty profile fields so autofill works.
  void prefillProfileOnce().catch((e) => console.warn('[autoapply.startup] profile prefill skipped:', e))

  // Once: company names typed in lowercase ("google") are shown capitalised.
  void tidyCompanyNamesOnce().catch((e) => console.warn('[autoapply.startup] company names skipped:', e))

  // Page audits and other throwaway servers: no scans or worker.
  if (process.env.AUTO_APPLY_NO_BACKGROUND === '1') return

  void companyScanLoop()

  // The job-description reader improved (experience, education, job type …):
  // re-score every job once so lists and filters use what it now finds.
  void (async () => {
    const { enqueue, kvGet, kvSet } = await import('@/lib/tasks/queue')
    if ((await kvGet(JD_ANALYZER_VERSION))?.value) return
    await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' })
    await kvSet(JD_ANALYZER_VERSION, { at: new Date().toISOString() })
  })().catch((e) => console.warn('[autoapply.startup] rescore skipped:', e))

  // The worker runs browser automation, Claude calls and JD fetches in its own
  // process. AUTO_APPLY_NO_WORKER=1 skips it (e.g. when you run it yourself).
  if (process.env.AUTO_APPLY_NO_WORKER !== '1') {
    const { superviseWorker } = await import('@/lib/server/worker-supervisor')
    void superviseWorker()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Bump when lib/jobs/analyze.ts or score.ts change how jobs are read or scored, so stored scores refresh. */
const JD_ANALYZER_VERSION = 'jd_analyzer_v4'

async function tidyCompanyNamesOnce(): Promise<void> {
  const { kvGet, kvSet } = await import('@/lib/tasks/queue')
  if ((await kvGet('company_names_tidied_v1'))?.value) return
  const db = await import('@/lib/server/db')
  const { tidyCompanyName } = await import('@/lib/companies/names')
  let n = 0
  for (const c of await db.listCompanies()) {
    const tidy = tidyCompanyName(c.name)
    if (tidy && tidy !== c.name) {
      await db.updateCompany(c.id, { name: tidy })
      n++
    }
  }
  await kvSet('company_names_tidied_v1', { at: new Date().toISOString(), renamed: n })
}

async function prefillProfileOnce(): Promise<void> {
  const { kvGet, kvSet } = await import('@/lib/tasks/queue')
  if ((await kvGet('profile_prefilled_v1'))?.value) return
  const { getDefaultBase } = await import('@/lib/resume/store')
  const base = await getDefaultBase()
  if (!base) return // try again next start, once a resume exists
  const { fillProfileGaps } = await import('@/lib/resume/profile-fill')
  const filled = fillProfileGaps(base.latex)
  await kvSet('profile_prefilled_v1', { at: new Date().toISOString(), filled })
  if (filled.length) console.log(`[autoapply.startup] Filled ${filled.length} profile fields from your resume: ${filled.join(', ')}`)
}

/**
 * Background scanning: every few minutes, queue the companies whose scan is
 * due (each one `interval` after its last scan, later after failures). The
 * worker runs the scans. Restarting the app doesn't rescan everything.
 */
async function companyScanLoop(): Promise<void> {
  await sleep(20_000) // let the server and worker settle first
  const { queueDueScans } = await import('@/lib/companies/schedule')
  for (;;) {
    try {
      const due = await queueDueScans()
      if (due.length) console.log(`[autoapply.scanloop] Queued ${due.length} due scan(s)`)
    } catch (e) {
      console.error('[autoapply.scanloop] Scheduling error', e)
    }
    await sleep(5 * 60_000)
  }
}
