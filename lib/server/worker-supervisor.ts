/**
 * Starts the worker as a child of the web server (so `npm start` / `npm run
 * dev` is all you need) and restarts it if its heartbeat stops. If a worker
 * is already running (e.g. you ran `npm run worker` yourself), it's left alone.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { DATA_DIR, ROOT_DIR } from './paths'

const G = Symbol.for('autoapply.worker.child')
type GlobalWith = typeof globalThis & { [G]?: ChildProcess | null }

export const WORKER_LOG = path.join(DATA_DIR, 'logs', 'worker.log')
const STALE_MS = 20_000

export async function heartbeatAge(): Promise<{ ageMs: number | null; value: Record<string, unknown> | null }> {
  const { kvGet } = await import('@/lib/tasks/queue')
  const hb = await kvGet<Record<string, unknown>>('worker.heartbeat').catch(() => null)
  if (!hb) return { ageMs: null, value: null }
  if (hb.value?.stopped) return { ageMs: null, value: hb.value }
  return { ageMs: Date.now() - Date.parse(hb.updated_at), value: hb.value }
}

export function spawnWorker(): ChildProcess {
  const g = globalThis as GlobalWith
  fs.mkdirSync(path.dirname(WORKER_LOG), { recursive: true })
  const out = fs.openSync(WORKER_LOG, 'a')
  const child = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--import',
      // --import needs a URL on Windows (a bare D:\ path is read as scheme "d:").
      pathToFileURL(path.join(ROOT_DIR, 'scripts', 'ts-resolve.mjs')).href,
      path.join(ROOT_DIR, 'worker', 'index.ts'),
    ],
    {
      cwd: ROOT_DIR,
      env: { ...process.env, AUTO_APPLY_WORKER_CHILD: '1' },
      stdio: ['pipe', out, out],
      windowsHide: true,
    },
  )
  child.on('exit', (code) => {
    if (g[G] === child) g[G] = null
    fs.appendFileSync(WORKER_LOG, `[supervisor] worker exited with code ${code}\n`)
  })
  g[G] = child
  return child
}

export async function stopWorker(): Promise<void> {
  const g = globalThis as GlobalWith
  const child = g[G]
  if (child && child.exitCode === null) {
    child.kill()
    await new Promise((r) => setTimeout(r, 800))
  }
  g[G] = null
}

export async function restartWorker(): Promise<void> {
  await stopWorker()
  spawnWorker()
}

/** Called from instrumentation: ensure exactly one worker is alive, forever. */
export async function superviseWorker(): Promise<void> {
  const g = globalThis as GlobalWith
  const check = async () => {
    const own = g[G]
    if (own && own.exitCode === null) return
    const { ageMs } = await heartbeatAge()
    if (ageMs !== null && ageMs < STALE_MS) return // someone else's worker is alive
    spawnWorker()
  }
  await check().catch((e) => console.warn('[autoapply.worker] start failed:', e))
  setInterval(() => void check().catch(() => {}), 15_000).unref()
}
