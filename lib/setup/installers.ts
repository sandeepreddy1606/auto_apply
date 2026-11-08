/**
 * One-click installers for Settings → Setup & health.
 *
 * Only these fixed commands can ever run — the tool id selects an entry; no
 * user-provided text reaches a command line. Output is streamed into the kv
 * store so the Setup page can show a live log.
 */
import path from 'node:path'

import { ROOT_DIR } from '@/lib/server/paths'
import { kvSet } from '@/lib/tasks/queue'

import { findTool, refreshTools, runTool } from './tools'

interface Installer {
  label: string
  platforms: NodeJS.Platform[]
  steps: () => { file: string; args: string[]; optional?: boolean }[]
}

const winget = () => findTool('winget') ?? 'winget'

export const INSTALLERS: Record<string, Installer> = {
  miktex: {
    label: 'MiKTeX (pdfLaTeX)',
    platforms: ['win32'],
    steps: () => [
      { file: winget(), args: ['install', '--id', 'MiKTeX.MiKTeX', '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'] },
    ],
  },
  miktex_autoinstall: {
    label: 'MiKTeX: install missing packages on the fly',
    platforms: ['win32'],
    steps: () => [{ file: findTool('initexmf') ?? 'initexmf', args: ['--set-config-value', '[MPM]AutoInstall=1'] }],
  },
  poppler: {
    label: 'Poppler (pdftotext, pdfinfo)',
    platforms: ['win32'],
    steps: () => [
      { file: winget(), args: ['install', '--id', 'oschwartz10612.Poppler', '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'] },
    ],
  },
  chromium: {
    label: 'Chromium for Playwright',
    platforms: ['win32', 'darwin', 'linux'],
    steps: () => [{ file: process.execPath, args: [path.join(ROOT_DIR, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'] }],
  },
}

export async function runInstaller(tool: string): Promise<{ ok: boolean; log: string }> {
  const inst = INSTALLERS[tool]
  if (!inst) throw new Error(`Unknown installer "${tool}"`)
  if (!inst.platforms.includes(process.platform)) {
    throw new Error(`${inst.label}: one-click install is only available on ${inst.platforms.join(', ')}. Install it with your package manager.`)
  }
  let log = ''
  const push = async (s: string) => {
    log += s
    if (log.length > 20_000) log = log.slice(-20_000)
    await kvSet(`install:${tool}`, { running: true, log }).catch(() => {})
  }
  await push(`$ ${inst.label}\n`)
  let ok = true
  for (const step of inst.steps()) {
    await push(`> ${path.basename(step.file)} ${step.args.join(' ')}\n`)
    const r = await runTool(step.file, step.args, {
      timeoutMs: 20 * 60_000,
      onData: (s) => void push(s),
    })
    // winget: "already installed" is success for our purposes.
    const already = /already installed|No available upgrade/i.test(r.stdout + r.stderr)
    if (r.code !== 0 && !already && !step.optional) {
      ok = false
      await push(`\nFailed (exit ${r.code}${r.timedOut ? ', timed out' : ''}).\n`)
      break
    }
  }
  refreshTools()
  if (ok) await push('\nDone. Re-checking…\n')
  await kvSet(`install:${tool}`, { running: false, ok, log })
  return { ok, log: log.slice(-4000) }
}
