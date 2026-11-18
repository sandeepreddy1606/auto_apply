/**
 * Boots the background work that the FastAPI `@app.on_event("startup")` hook
 * used to run: the Telegram listener and the periodic company-scan loop.
 *
 * start() runs once per server process (from instrumentation.ts). `next start` runs a single
 * process, which is what the MTProto session requires — it must have exactly
 * one holder. The guard below also keeps dev-mode hot reloads from starting a
 * second listener.
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

  // Page audits and other throwaway servers: no Telegram, scans or worker.
  if (process.env.AUTO_APPLY_NO_BACKGROUND === '1') return

  const [{ manager }, service] = await Promise.all([import('@/lib/server/telegram'), import('@/lib/server/service')])

  manager.setIngestCallback(service.ingestFromTelegram)
  // One-time data fixes (re-opening Google Forms that stopped for sign-in,
  // adding details to older posts) run in the worker at its start — the
  // worker restarts itself on new code, so they always run.
  void manager.tryAutostart().catch((e) => {
    console.warn('[autoapply.startup] telegram autostart failed:', e)
  })

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

/** Bump when lib/jobs/analyze.ts reads descriptions differently, so stored scores refresh. */
const JD_ANALYZER_VERSION = 'jd_analyzer_v3'

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
