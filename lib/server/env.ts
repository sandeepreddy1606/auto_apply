/**
 * Loads environment from a repo-root .env (no external dependency) and exposes
 * app configuration. Imported early so DATABASE_URL is available before the
 * database module decides which backend to use.
 *
 * Next.js loads .env itself, but instrumentation and standalone scripts can
 * import this module before that happens — so the parse is kept.
 */
import fs from 'node:fs'
import path from 'node:path'

import { ROOT_DIR } from './paths'

const ENV_PATH = path.join(ROOT_DIR, '.env')

function loadEnv(): void {
  if (!fs.existsSync(ENV_PATH)) return
  try {
    let text = fs.readFileSync(ENV_PATH, 'utf-8')
    // Strip a leading BOM (e.g. from Notepad / "UTF-8 with BOM"), which would
    // otherwise corrupt the first key name and disable DATABASE_URL.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const eq = line.indexOf('=')
      const key = line.slice(0, eq).trim()
      const val = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      // Real environment variables take precedence over the file.
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    /* unreadable .env is not fatal */
  }
}

loadEnv()

export const DATABASE_URL = (process.env.DATABASE_URL || '').trim()
