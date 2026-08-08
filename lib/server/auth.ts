/**
 * Single-user authentication: PBKDF2 password hashing + stateless HMAC tokens.
 *
 * Credentials live in data/auth.json (never exposed by the settings API). Tokens
 * are stateless HMAC-signed blobs — they survive server restarts and carry only
 * an expiry, so there is no session table to manage. Rotating the server secret
 * (on password change) invalidates every previously issued token.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

import { AUTH_PATH } from './paths'

const ITERATIONS = 200_000
const KEYLEN = 32
const DIGEST = 'sha256'
export const TOKEN_TTL_SECONDS = 30 * 24 * 3600 // 30 days
const MIN_PASSWORD_LEN = 6

interface AuthFile {
  salt?: string
  hash?: string
  secret?: string
  created_at?: number
}

function read(): AuthFile {
  if (!fs.existsSync(AUTH_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8')) as AuthFile
  } catch {
    return {}
  }
}

/**
 * Atomic write so a crash mid-write can't corrupt auth.json (which would lock
 * you out or wipe your password).
 */
function write(data: AuthFile): void {
  const tmp = `${AUTH_PATH}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, AUTH_PATH)
}

function hashPassword(password: string, salt: Buffer): string {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex')
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8')
  const bb = Buffer.from(b, 'utf-8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export function isPasswordSet(): boolean {
  return Boolean(read().hash)
}

/** Create the password for the first time (fails if one already exists). */
export function setPassword(password: string): void {
  const pw = (password || '').trim()
  if (pw.length < MIN_PASSWORD_LEN) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters.`)
  }
  const data = read()
  if (data.hash) throw new Error('A password is already set.')
  const salt = crypto.randomBytes(16)
  write({
    salt: salt.toString('hex'),
    hash: hashPassword(pw, salt),
    secret: crypto.randomBytes(32).toString('hex'),
    created_at: Math.floor(Date.now() / 1000),
  })
}

export function verifyPassword(password: string): boolean {
  const data = read()
  if (!data.hash || !data.salt) return false
  let salt: Buffer
  try {
    salt = Buffer.from(data.salt, 'hex')
  } catch {
    return false
  }
  return safeEqual(hashPassword(password || '', salt), data.hash)
}

export function changePassword(current: string, next: string): void {
  if (!verifyPassword(current)) throw new Error('Current password is incorrect.')
  const pw = (next || '').trim()
  if (pw.length < MIN_PASSWORD_LEN) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters.`)
  }
  const data = read()
  const salt = crypto.randomBytes(16)
  data.salt = salt.toString('hex')
  data.hash = hashPassword(pw, salt)
  data.secret = crypto.randomBytes(32).toString('hex') // rotate -> invalidates old tokens
  write(data)
}

function secret(): string {
  return read().secret || ''
}

const b64url = (buf: Buffer): string => buf.toString('base64url')

function sign(payloadB64: string, key: string): string {
  return b64url(crypto.createHmac('sha256', key).update(payloadB64, 'ascii').digest())
}

export function issueToken(): string {
  const key = secret()
  if (!key) throw new Error('No password configured.')
  const payload = { exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf-8'))
  return `${payloadB64}.${sign(payloadB64, key)}`
}

/**
 * Never throws — a malformed/hostile header must yield a clean false (401),
 * not a 500.
 */
export function verifyToken(token: string | null | undefined): boolean {
  if (!token || !token.includes('.')) return false
  const key = secret()
  if (!key) return false
  try {
    const dot = token.indexOf('.')
    const payloadB64 = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    if (!safeEqual(sig, sign(payloadB64, key))) return false
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8'),
    ) as { exp?: number }
    return Number(payload.exp || 0) > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

/** Pull a bearer token out of an Authorization header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7) : null
}
