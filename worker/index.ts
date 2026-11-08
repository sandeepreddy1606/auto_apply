/**
 * Worker process: runs queued tasks (browser automation, Claude calls, JD
 * fetches, rescoring, installs) outside the web server, so slow or crashing
 * work never freezes the UI.
 *
 *   npm run worker        (start.ps1 and the web server start it automatically)
 *
 * Lanes: browser (1 at a time), llm (1 at a time), default (3 in parallel).
 * Writes a heartbeat every 5 s; the web server restarts the worker if it stops.
 */
import { closeAll, reapIdle } from '@/lib/apply/browser'
import { HANDLERS } from '@/lib/tasks/handlers'
import { claim, complete, fail, kvSet, prune, reclaimStuck, requeueOrphans } from '@/lib/tasks/queue'
import type { Lane, Task } from '@/lib/tasks/queue'

const WORKER_ID = `worker-${process.pid}`
const LANES: Record<Lane, number> = { browser: 1, llm: 1, default: 3 }
const running: Record<Lane, number> = { browser: 0, llm: 0, default: 0 }
let stopping = false
let lastTask: { id: number; type: string; at: string } | null = null

const log = (...a: unknown[]) => console.log(`[worker ${new Date().toISOString()}]`, ...a)

async function runTask(task: Task): Promise<void> {
  const handler = HANDLERS[task.type]
  if (!handler) {
    await fail(task, `No handler for task type ${task.type}`, { retry: false })
    return
  }
  lastTask = { id: task.id, type: task.type, at: new Date().toISOString() }
  const t0 = Date.now()
  try {
    const result = await handler(task)
    await complete(task.id, result ?? null)
    log(`✓ ${task.type}#${task.id} in ${Date.now() - t0}ms`)
  } catch (e) {
    const msg = (e as Error).message || String(e)
    const outcome = await fail(task, msg)
    log(`✗ ${task.type}#${task.id} (${outcome}): ${msg.split('\n')[0]}`)
  }
}

async function pump(): Promise<boolean> {
  let started = false
  for (const lane of Object.keys(LANES) as Lane[]) {
    while (!stopping && running[lane] < LANES[lane]) {
      const task = await claim(lane, WORKER_ID)
      if (!task) break
      started = true
      running[lane]++
      void runTask(task).finally(() => {
        running[lane]--
      })
    }
  }
  return started
}

async function heartbeat(): Promise<void> {
  await kvSet('worker.heartbeat', {
    pid: process.pid,
    id: WORKER_ID,
    running,
    last_task: lastTask,
    node: process.version,
  }).catch((e) => log('heartbeat failed:', (e as Error).message))
}

async function main(): Promise<void> {
  log(`starting (${WORKER_ID})`)
  const orphans = await requeueOrphans()
  if (orphans) log(`requeued ${orphans} task(s) left running by a previous worker`)
  await heartbeat()
  const hb = setInterval(() => void heartbeat(), 5_000)
  const maint = setInterval(() => {
    void reclaimStuck().catch(() => {})
    void reapIdle().catch(() => {})
    void prune().catch(() => {})
  }, 60_000)

  const shutdown = async (sig: string) => {
    if (stopping) return
    stopping = true
    log(`${sig}: shutting down`)
    clearInterval(hb)
    clearInterval(maint)
    await closeAll().catch(() => {})
    await kvSet('worker.heartbeat', { pid: process.pid, id: WORKER_ID, stopped: true }).catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // The web server talks to us over stdin when it spawned us; its exit closes stdin.
  if (process.env.AUTO_APPLY_WORKER_CHILD === '1') process.stdin.on('end', () => void shutdown('parent exited')).resume()

  while (!stopping) {
    let busy = false
    try {
      busy = await pump()
    } catch (e) {
      log('pump error:', (e as Error).message)
    }
    const anyRunning = Object.values(running).some((n) => n > 0)
    await new Promise((r) => setTimeout(r, busy || anyRunning ? 300 : 1000))
  }
}

process.on('unhandledRejection', (e) => log('unhandled rejection:', e))
void main()
