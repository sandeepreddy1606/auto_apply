/**
 * Locating and running external tools: pdflatex (MiKTeX/TeX Live), poppler
 * (pdftotext/pdfinfo), the Claude Code CLI and Playwright's Chromium.
 *
 * Windows installs often aren't on the PATH of an already-running process
 * (MiKTeX right after install, for example), so well-known install folders are
 * searched too. Results are cached briefly; `refreshTools()` clears the cache
 * after an install.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const IS_WIN = process.platform === 'win32'
const EXT = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : ['']

function candidatesDirs(tool: string): string[] {
  const home = os.homedir()
  const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const dirs: string[] = []
  if (IS_WIN) {
    if (tool === 'pdflatex' || tool === 'latexmk' || tool === 'initexmf' || tool === 'miktex') {
      dirs.push(
        path.join(la, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
        path.join(pf, 'MiKTeX', 'miktex', 'bin', 'x64'),
        path.join(pf86, 'MiKTeX', 'miktex', 'bin'),
        'C:\\texlive\\2025\\bin\\windows',
        'C:\\texlive\\2024\\bin\\windows',
      )
    }
    if (tool === 'pdftotext' || tool === 'pdfinfo') {
      dirs.push(
        'C:\\Program Files\\Git\\mingw64\\bin',
        path.join(pf, 'poppler', 'Library', 'bin'),
        path.join(la, 'Microsoft', 'WinGet', 'Links'),
      )
      // winget installs poppler under a versioned folder.
      const pkgs = path.join(la, 'Microsoft', 'WinGet', 'Packages')
      try {
        for (const d of fs.readdirSync(pkgs)) {
          if (!/poppler/i.test(d)) continue
          const root = path.join(pkgs, d)
          for (const v of fs.readdirSync(root)) dirs.push(path.join(root, v, 'Library', 'bin'))
        }
      } catch {
        /* not installed */
      }
    }
    if (tool === 'claude') dirs.push(path.join(home, '.local', 'bin'), path.join(process.env.APPDATA || '', 'npm'))
  } else {
    dirs.push('/usr/local/bin', '/usr/bin', '/opt/homebrew/bin', '/Library/TeX/texbin', path.join(home, '.local', 'bin'))
  }
  return dirs
}

const cache = new Map<string, { at: number; value: string | null }>()

export function refreshTools(): void {
  cache.clear()
}

/** Absolute path of an executable, or null. */
export function findTool(tool: string): string | null {
  const hit = cache.get(tool)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
  let found: string | null = null
  outer: for (const dir of [...pathDirs, ...candidatesDirs(tool)]) {
    for (const ext of EXT) {
      const p = path.join(dir, tool + ext)
      try {
        if (fs.statSync(p).isFile()) {
          found = p
          break outer
        }
      } catch {
        /* keep looking */
      }
    }
  }
  cache.set(tool, { at: Date.now(), value: found })
  return found
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Run a command without a shell (arguments are never re-parsed, so nothing in
 * them can inject commands). `.cmd`/`.bat` shims are the one exception on
 * Windows: they can only be launched through cmd.exe, with quoted args.
 */
export function runTool(
  file: string,
  args: string[],
  opts: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; onData?: (s: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const isShim = IS_WIN && /\.(cmd|bat)$/i.test(file)
    const child = isShim
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${[file, ...args].map(quoteWin).join(' ')}"`], {
          cwd: opts.cwd,
          env: opts.env ?? process.env,
          windowsVerbatimArguments: true,
          windowsHide: true,
        })
      : spawn(file, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, opts.timeoutMs ?? 120_000)
    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString('utf-8')
      stdout += s
      opts.onData?.(s)
    })
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString('utf-8')
      stderr += s
      opts.onData?.(s)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(e.message), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    if (opts.input != null) {
      child.stdin?.end(opts.input, 'utf-8')
    } else {
      child.stdin?.end()
    }
  })
}

function quoteWin(a: string): string {
  if (a && !/[\s"&|<>^%]/.test(a)) return a
  return `"${a.replace(/"/g, '""')}"`
}

export async function toolVersion(tool: string, args = ['--version']): Promise<string | null> {
  const p = findTool(tool)
  if (!p) return null
  const r = await runTool(p, args, { timeoutMs: 20_000 })
  if (r.code !== 0 && !r.stdout) return null
  return (r.stdout || r.stderr).split('\n')[0].trim() || 'installed'
}

/** Chromium for Playwright installed? (Checks the browser cache, without launching.) */
export function playwrightChromiumPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const base =
      process.env.PLAYWRIGHT_BROWSERS_PATH ||
      (IS_WIN
        ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
        : process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
          : path.join(os.homedir(), '.cache', 'ms-playwright'))
    const dirs = fs.readdirSync(base).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
    return dirs.length ? path.join(base, dirs.sort().pop()!) : null
  } catch {
    return null
  }
}
