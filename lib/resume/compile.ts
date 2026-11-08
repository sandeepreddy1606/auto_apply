/**
 * pdfLaTeX compile in an isolated temp directory, then text extraction with
 * poppler. Sandboxed: no shell escape, paranoid file access, hard timeout.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findTool, runTool } from '@/lib/setup/tools'
import type { CompileError } from '@/lib/types'

export interface CompileResult {
  ok: boolean
  pdf: Buffer | null
  log: string
  errors: CompileError[]
  pages: number
  text: string
}

export class CompilerMissingError extends Error {
  constructor() {
    super('pdfLaTeX is not installed. Install MiKTeX from Settings → Setup & health.')
    this.name = 'CompilerMissingError'
  }
}

/** "./main.tex:42: Undefined control sequence." (from -file-line-error) and "! ..." lines. */
export function parseLatexLog(log: string): CompileError[] {
  const errors: CompileError[] = []
  const seen = new Set<string>()
  for (const line of log.split(/\r?\n/)) {
    const m = /^(?:\.\/|.*[\\/])?main\.tex:(\d+):\s*(.+)$/.exec(line)
    if (m) {
      const key = `${m[1]}:${m[2]}`
      if (!seen.has(key)) {
        seen.add(key)
        errors.push({ line: Number(m[1]), message: m[2].trim() })
      }
      continue
    }
    const bang = /^!\s*(.+)$/.exec(line)
    if (bang && !errors.some((e) => e.message === bang[1].trim())) {
      errors.push({ line: null, message: bang[1].trim() })
    }
  }
  if (/Emergency stop|Fatal error/i.test(log) && !errors.length) {
    errors.push({ line: null, message: 'LaTeX stopped with a fatal error — see the log.' })
  }
  return errors.slice(0, 20)
}

export function compilerAvailable(): boolean {
  return !!findTool('pdflatex')
}

export async function pdfToText(pdfPath: string): Promise<{ text: string; pages: number } | null> {
  const bin = findTool('pdftotext')
  if (!bin) return null
  const r = await runTool(bin, ['-enc', 'UTF-8', pdfPath, '-'], { timeoutMs: 30_000 })
  if (r.code !== 0) return null
  // pdftotext separates pages with form feeds; a trailing one ends the last page.
  const pages = r.stdout.split('\f').filter((p, i, arr) => p.trim() || i < arr.length - 1).length
  return { text: r.stdout.replace(/\f/g, '\n'), pages: Math.max(1, pages) }
}

async function pageCount(pdfPath: string, fallbackText: string | null): Promise<number> {
  const info = findTool('pdfinfo')
  if (info) {
    const r = await runTool(info, [pdfPath], { timeoutMs: 15_000 })
    const m = /Pages:\s+(\d+)/.exec(r.stdout)
    if (m) return Number(m[1])
  }
  if (fallbackText) return fallbackText.split('\f').length
  return 0
}

/**
 * Compile `latex` (plus any extra files such as .cls/.sty kept with the base)
 * and return the PDF, errors mapped to line numbers, page count and text.
 */
export async function compileLatex(
  latex: string,
  opts: { extraFiles?: Record<string, Buffer | string>; timeoutMs?: number } = {},
): Promise<CompileResult> {
  const bin = findTool('pdflatex')
  if (!bin) throw new CompilerMissingError()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-tex-'))
  try {
    fs.writeFileSync(path.join(dir, 'main.tex'), latex, 'utf-8')
    for (const [name, content] of Object.entries(opts.extraFiles ?? {})) {
      // Only plain file names: nothing can be written outside the build dir.
      if (!/^[\w.-]+\.(cls|sty|tex|bib|png|jpg|pdf)$/i.test(name)) continue
      fs.writeFileSync(path.join(dir, name), content)
    }
    const miktex = /miktex/i.test(bin)
    const args = [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-file-line-error',
      '-no-shell-escape',
      ...(miktex ? ['-enable-installer'] : []),
      'main.tex',
    ]
    const env = {
      ...process.env,
      openin_any: 'p', // TeX Live: refuse to read files outside the build dir
      openout_any: 'p',
      shell_escape: 'f',
    }
    let log = ''
    let r = await runTool(bin, args, { cwd: dir, env, timeoutMs: opts.timeoutMs ?? 300_000 })
    log = safeRead(path.join(dir, 'main.log')) || r.stdout + r.stderr
    // A second pass only when LaTeX asks for it (labels, page refs).
    if (r.code === 0 && /Rerun to get|Label\(s\) may have changed/.test(log)) {
      r = await runTool(bin, args, { cwd: dir, env, timeoutMs: opts.timeoutMs ?? 300_000 })
      log = safeRead(path.join(dir, 'main.log')) || r.stdout + r.stderr
    }
    const pdfPath = path.join(dir, 'main.pdf')
    const pdf = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : null
    if (r.timedOut) {
      return { ok: false, pdf: null, log, errors: [{ line: null, message: 'Compile timed out (first runs may be installing packages — try again).' }], pages: 0, text: '' }
    }
    const errors = parseLatexLog(log)
    if (!pdf || r.code !== 0) {
      return { ok: false, pdf, log, errors: errors.length ? errors : [{ line: null, message: `pdflatex exited with code ${r.code}` }], pages: 0, text: '' }
    }
    const extracted = await pdfToText(pdfPath)
    const pages = await pageCount(pdfPath, extracted?.text ?? null)
    return { ok: true, pdf, log, errors, pages: extracted?.pages && !pages ? extracted.pages : pages, text: extracted?.text ?? '' }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function safeRead(p: string): string {
  try {
    return fs.readFileSync(p, 'latin1')
  } catch {
    return ''
  }
}
