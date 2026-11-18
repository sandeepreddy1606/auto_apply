import fs from 'node:fs'
import path from 'node:path'

export const ROOT_DIR = process.cwd()

// AUTO_APPLY_DATA_DIR lets you run an isolated instance (e.g. for testing)
// without touching your real settings, database or login.
export const DATA_DIR =
  process.env.AUTO_APPLY_DATA_DIR || path.join(ROOT_DIR, 'data')

export const DB_PATH = path.join(DATA_DIR, 'auto_apply.db')
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json')
export const AUTH_PATH = path.join(DATA_DIR, 'auth.json')
export const RESUMES_DIR = path.join(DATA_DIR, 'resumes')
export const CLAUDE_APPS_PATH = path.join(DATA_DIR, 'claude_applications.json')
// The previous Python build (Telethon) wrote a SQLite session database at
// `telegram.session`; teleproto persists a StringSession, so this is a plain
// text file instead. The two are not interchangeable — see README.
export const TELEGRAM_SESSION_PATH = path.join(DATA_DIR, 'telegram.session.txt')

fs.mkdirSync(DATA_DIR, { recursive: true })
