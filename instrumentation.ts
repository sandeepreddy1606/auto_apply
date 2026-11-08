/**
 * Boots the background work that the FastAPI `@app.on_event("startup")` hook
 * used to run: the Telegram listener and the periodic company-scan loop.
 *
 * register() is called once per server process. `next start` runs a single
 * process, which is what the MTProto session requires — it must have exactly
 * one holder. The guard below also keeps dev-mode hot reloads from starting a
 * second listener.
 */
const STARTED = Symbol.for('autoapply.instrumentation.started')
type GlobalFlag = typeof globalThis & { [STARTED]?: boolean }

export async function register(): Promise<void> {
  // Only the Node.js server runtime should run this (not the edge compilation).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const g = globalThis as GlobalFlag
  if (g[STARTED]) return
  g[STARTED] = true
  // Page audits and other throwaway servers: no Telegram, scans or worker.
  if (process.env.AUTO_APPLY_NO_BACKGROUND === '1') return

  const [{ manager }, service, db, scanner, settingsStore] = await Promise.all([
    import('@/lib/server/telegram'),
    import('@/lib/server/service'),
    import('@/lib/server/db'),
    import('@/lib/server/scanner'),
    import('@/lib/server/settings'),
  ])

  manager.setIngestCallback(service.ingestFromTelegram)
  void manager.tryAutostart().catch((e) => {
    console.warn('[autoapply.startup] telegram autostart failed:', e)
  })

  void companyScanLoop(db, scanner, settingsStore)

  // The worker runs browser automation, Claude calls and JD fetches in its own
  // process. AUTO_APPLY_NO_WORKER=1 skips it (e.g. when you run it yourself).
  if (process.env.AUTO_APPLY_NO_WORKER !== '1') {
    const { superviseWorker } = await import('@/lib/server/worker-supervisor')
    void superviseWorker()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Periodically rescan every company's career page in the background. */
async function companyScanLoop(
  db: typeof import('@/lib/server/db'),
  scanner: typeof import('@/lib/server/scanner'),
  settingsStore: typeof import('@/lib/server/settings'),
): Promise<void> {
  await sleep(30_000) // let the server settle first
  for (;;) {
    let intervalMinutes = 180
    try {
      const cfg = settingsStore.load().companies
      intervalMinutes = Number(cfg.scan_interval_minutes) || 180
      if (cfg.auto_scan !== false) {
        for (const company of await db.listCompanies()) {
          try {
            await scanner.scanCompany(company, settingsStore.load())
          } catch (e) {
            if (e instanceof scanner.ScanError) {
              console.warn(
                `[autoapply.scanloop] Scan failed for ${company.name}: ${e.message}`,
              )
            } else {
              console.error(`[autoapply.scanloop] Scan crashed for ${company.name}`, e)
            }
          }
        }
      }
    } catch (e) {
      console.error('[autoapply.scanloop] Company scan loop error', e)
    }
    await sleep(Math.max(intervalMinutes, 15) * 60_000)
  }
}
