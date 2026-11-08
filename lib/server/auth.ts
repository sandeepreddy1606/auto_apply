/**
 * Accounts and sessions.
 *
 * - One owner account, created on first run through the sign-up page (the app
 *   keeps one person's profile, resume and Telegram login, so a second account
 *   would see the same data — sign-up closes once the owner exists).
 * - Passwords are hashed with scrypt. Hashes from the old single-password
 *   build (PBKDF2 in data/auth.json) still verify and are upgraded on use.
 * - Sessions are random tokens; only their SHA-256 is stored, in `sessions`.
 *   The browser gets them in an httpOnly cookie. API clients (the browser
 *   extension, scripts) may send the same token as `Authorization: Bearer`.
 * - Forgot password: a one-time recovery code shown at sign-up, or a 6-digit
 *   code emailed through your SMTP settings when they're configured.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

import { sql } from './db'
import { AUTH_PATH } from './paths'

// ---------- constants ----------

export const SESSION_COOKIE = 'aa_session'
/** "Keep me signed in": 30 days, extended while you keep using the app. */
export const REMEMBER_TTL_MS = 30 * 24 * 3600 * 1000
/** Otherwise: ends after 12 hours of inactivity (and when the browser closes). */
export const SHORT_TTL_MS = 12 * 3600 * 1000
export const MIN_PASSWORD_LEN = 8
const LOCK_AFTER = 5
const LOCK_WINDOW_MS = 15 * 60 * 1000
const RESET_CODE_TTL_MS = 15 * 60 * 1000
const RESET_MAX_ATTEMPTS = 5
const TOUCH_EVERY_MS = 5 * 60 * 1000

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export class AuthError extends Error {
  status: number
  retryAfter?: number
  constructor(status: number, message: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

export interface User {
  id: number
  email: string
  name: string
  role: string
  created_at: string
  password_changed_at: string | null
  last_login_at: string | null
}

export interface SessionInfo {
  id: number
  user_id: number
  remember: boolean
  user_agent: string | null
  ip: string | null
  created_at: string
  last_seen_at: string
  expires_at: string
}

export interface ClientMeta {
  userAgent?: string | null
  ip?: string | null
}

// ---------- password hashing ----------

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(password, salt)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8')
  const bb = Buffer.from(b, 'utf-8')
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

/** Verify against a stored hash: scrypt (current) or pbkdf2 (old build). */
export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const parts = (stored || '').split('$')
  try {
    if (parts[0] === 'scrypt' && parts.length === 6) {
      const key = await scrypt(password || '', Buffer.from(parts[4], 'hex'))
      return safeEqualHex(key.toString('hex'), parts[5])
    }
    if (parts[0] === 'pbkdf2' && parts.length === 4) {
      const salt = Buffer.from(parts[2], 'hex')
      const iter = Number(parts[1])
      // The old build trimmed on set but not on verify — accept either.
      for (const pw of new Set([password || '', (password || '').trim()])) {
        const h = crypto.pbkdf2Sync(pw, salt, iter, 32, 'sha256').toString('hex')
        if (safeEqualHex(h, parts[3])) return true
      }
    }
  } catch {
    /* malformed hash */
  }
  return false
}

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'qwertyuiop', 'iloveyou', 'admin123', 'welcome1', 'letmein1', 'abcd1234', '11111111',
  '00000000', 'autoapply', 'passw0rd',
])

/** Returns a friendly reason the password can't be used, or null. */
export function passwordProblem(password: string, ctx: { email?: string; name?: string } = {}): string | null {
  const pw = password || ''
  if (pw.length < MIN_PASSWORD_LEN) return `Use at least ${MIN_PASSWORD_LEN} characters.`
  if (pw.length > 200) return 'That password is too long (200 characters max).'
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common — pick something less guessable.'
  if (/^(.)\1+$/.test(pw)) return 'Don’t use a single repeated character.'
  const email = (ctx.email || '').toLowerCase()
  if (email && (pw.toLowerCase() === email || pw.toLowerCase() === email.split('@')[0])) {
    return 'Don’t use your email as your password.'
  }
  return null
}

// ---------- emails ----------

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254
}

// ---------- legacy single-password file ----------

interface LegacyAuth {
  salt?: string
  hash?: string
}

function legacyHash(): string | null {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null
    const data = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8')) as LegacyAuth
    return data.hash && data.salt ? `pbkdf2$200000$${data.salt}$${data.hash}` : null
  } catch {
    return null
  }
}

function retireLegacyFile(): void {
  try {
    if (fs.existsSync(AUTH_PATH)) fs.renameSync(AUTH_PATH, `${AUTH_PATH}.migrated`)
  } catch {
    /* harmless — the users table now wins */
  }
}

// ---------- users ----------

const USER_COLS = 'id, email, name, role, created_at, password_changed_at, last_login_at'

function toUser(r: Record<string, unknown> | null): User | null {
  if (!r) return null
  return {
    id: Number(r.id),
    email: String(r.email),
    name: String(r.name ?? ''),
    role: String(r.role ?? 'owner'),
    created_at: String(r.created_at),
    password_changed_at: (r.password_changed_at as string | null) ?? null,
    last_login_at: (r.last_login_at as string | null) ?? null,
  }
}

export async function userCount(): Promise<number> {
  return Number((await sql.one('SELECT COUNT(*) AS n FROM users'))?.n ?? 0)
}

export async function getUser(id: number): Promise<User | null> {
  return toUser(await sql.one(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]))
}

async function userRowByEmail(email: string): Promise<Record<string, unknown> | null> {
  return sql.one('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)])
}

/** What the sign-in screen should show. */
export async function setupState(): Promise<'signup' | 'upgrade' | 'login'> {
  if ((await userCount()) > 0) return 'login'
  return legacyHash() ? 'upgrade' : 'signup'
}

function newRecoveryCode(): string {
  // 16 chars from an unambiguous alphabet, grouped for reading: K7QM-2XRD-…
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(16)
  let s = ''
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s.match(/.{4}/g)!.join('-')
}

const normRecovery = (c: string) => (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function validateIdentity(name: string, email: string): { name: string; email: string } {
  const n = (name || '').trim().replace(/\s+/g, ' ')
  const e = normalizeEmail(email)
  if (!n) throw new AuthError(400, 'Tell us your name.')
  if (n.length > 80) throw new AuthError(400, 'That name is too long.')
  if (!isValidEmail(e)) throw new AuthError(400, 'Enter a valid email address.')
  return { name: n, email: e }
}

async function insertOwner(name: string, email: string, passwordHash: string): Promise<{ user: User; recoveryCode: string }> {
  const recoveryCode = newRecoveryCode()
  const recoveryHash = await hashPassword(normRecovery(recoveryCode))
  const now = sql.nowIso()
  const id = await sql.tx(async (b) => {
    const n = Number((await b.one('SELECT COUNT(*) AS n FROM users'))?.n ?? 0)
    if (n > 0) throw new AuthError(403, 'An account already exists here. Sign in instead.')
    return b.insert(
      `INSERT INTO users (email, name, password_hash, role, recovery_hash, created_at, updated_at, password_changed_at)
       VALUES (?, ?, ?, 'owner', ?, ?, ?, ?)`,
      [email, name, passwordHash, recoveryHash, now, now, now],
    )
  })
  return { user: (await getUser(id))!, recoveryCode }
}

/** First-run sign-up. Closed once the owner account exists. */
export async function signUp(input: { name: string; email: string; password: string }): Promise<{ user: User; recoveryCode: string }> {
  const state = await setupState()
  if (state === 'login') throw new AuthError(403, 'An account already exists here. Sign in instead.')
  if (state === 'upgrade') throw new AuthError(409, 'Finish upgrading your existing password first.')
  const { name, email } = validateIdentity(input.name, input.email)
  const problem = passwordProblem(input.password, { email, name })
  if (problem) throw new AuthError(400, problem)
  return insertOwner(name, email, await hashPassword(input.password))
}

/** Turn the old single dashboard password into an account (keeps the password unless a new one is given). */
export async function upgradeLegacy(input: {
  currentPassword: string
  name: string
  email: string
  newPassword?: string
}): Promise<{ user: User; recoveryCode: string }> {
  if ((await setupState()) !== 'upgrade') throw new AuthError(409, 'Nothing to upgrade.')
  const legacy = legacyHash()!
  if (!(await verifyPasswordHash(input.currentPassword, legacy))) {
    throw new AuthError(401, 'That isn’t your current dashboard password.')
  }
  const { name, email } = validateIdentity(input.name, input.email)
  let hash: string
  if (input.newPassword) {
    const problem = passwordProblem(input.newPassword, { email, name })
    if (problem) throw new AuthError(400, problem)
    hash = await hashPassword(input.newPassword)
  } else {
    hash = await hashPassword(input.currentPassword.trim() || input.currentPassword)
  }
  const out = await insertOwner(name, email, hash)
  retireLegacyFile()
  return out
}

// ---------- rate limiting ----------

interface Bucket {
  fails: number[]
  lockedUntil: number
}
const g = globalThis as unknown as { __aaLoginBuckets?: Map<string, Bucket> }
const buckets = (g.__aaLoginBuckets ??= new Map<string, Bucket>())

function bucketKeys(email: string, ip?: string | null): string[] {
  return [`e:${normalizeEmail(email)}`, ...(ip ? [`i:${ip}`] : [])]
}

function lockedFor(keys: string[]): number {
  const now = Date.now()
  let wait = 0
  for (const k of keys) {
    const b = buckets.get(k)
    if (b && b.lockedUntil > now) wait = Math.max(wait, b.lockedUntil - now)
  }
  return wait
}

function recordFailure(keys: string[]): void {
  const now = Date.now()
  for (const k of keys) {
    const b = buckets.get(k) ?? { fails: [], lockedUntil: 0 }
    b.fails = b.fails.filter((t) => now - t < LOCK_WINDOW_MS)
    b.fails.push(now)
    // IP buckets tolerate more noise (several people behind one router).
    const limit = k.startsWith('i:') ? LOCK_AFTER * 4 : LOCK_AFTER
    if (b.fails.length >= limit) {
      b.lockedUntil = now + LOCK_WINDOW_MS
      b.fails = []
    }
    buckets.set(k, b)
  }
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.lockedUntil < now && !b.fails.some((t) => now - t < LOCK_WINDOW_MS)) buckets.delete(k)
  }
}

function clearFailures(email: string): void {
  buckets.delete(`e:${normalizeEmail(email)}`)
}

function lockError(waitMs: number): AuthError {
  const mins = Math.max(1, Math.ceil(waitMs / 60000))
  return new AuthError(
    429,
    `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`,
    Math.ceil(waitMs / 1000),
  )
}

/** Test helper. */
export function _resetRateLimits(): void {
  buckets.clear()
}

// ---------- login ----------

export async function login(email: string, password: string, meta: ClientMeta = {}): Promise<User> {
  const keys = bucketKeys(email, meta.ip)
  const wait = lockedFor(keys)
  if (wait) throw lockError(wait)
  const row = await userRowByEmail(email)
  // Hash even when the user doesn't exist so timing doesn't reveal it.
  const ok = await verifyPasswordHash(password, row ? String(row.password_hash) : 'scrypt$16384$8$1$00$00')
  if (!row || !ok) {
    if ((await userCount()) === 0) throw new AuthError(409, 'There’s no account yet — create one first.')
    recordFailure(keys)
    const after = lockedFor(keys)
    if (after) throw lockError(after)
    throw new AuthError(401, 'That email and password don’t match.')
  }
  clearFailures(email)
  const now = sql.nowIso()
  // Upgrade old PBKDF2 hashes to scrypt on a successful login.
  if (!String(row.password_hash).startsWith('scrypt$')) {
    await sql.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), Number(row.id)])
  }
  await sql.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, Number(row.id)])
  return (await getUser(Number(row.id)))!
}

// ---------- sessions ----------

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf-8').digest('hex')

export async function createSession(userId: number, remember: boolean, meta: ClientMeta = {}): Promise<{ token: string; expiresAt: Date; id: number }> {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (remember ? REMEMBER_TTL_MS : SHORT_TTL_MS))
  const id = await sql.insert(
    `INSERT INTO sessions (user_id, token_hash, remember, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      sha256(token),
      remember ? 1 : 0,
      (meta.userAgent || '').slice(0, 300) || null,
      (meta.ip || '').slice(0, 64) || null,
      now.toISOString(),
      now.toISOString(),
      expiresAt.toISOString(),
    ],
  )
  return { token, expiresAt, id }
}

/** Resolve a token to its session + user, sliding the expiry forward. Never throws. */
export async function resolveSession(token: string | null | undefined): Promise<{ session: SessionInfo; user: User } | null> {
  if (!token || token.length < 20 || token.length > 200) return null
  try {
    const row = await sql.one('SELECT * FROM sessions WHERE token_hash = ?', [sha256(token)])
    if (!row) return null
    const now = Date.now()
    if (Date.parse(String(row.expires_at)) <= now) {
      await sql.run('DELETE FROM sessions WHERE id = ?', [Number(row.id)])
      return null
    }
    const user = await getUser(Number(row.user_id))
    if (!user) return null
    if (now - Date.parse(String(row.last_seen_at)) > TOUCH_EVERY_MS) {
      const ttl = Number(row.remember) ? REMEMBER_TTL_MS : SHORT_TTL_MS
      const exp = new Date(now + ttl).toISOString()
      await sql.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [new Date(now).toISOString(), exp, Number(row.id)])
      row.expires_at = exp
    }
    return { session: toSession(row), user }
  } catch {
    return null
  }
}

function toSession(r: Record<string, unknown>): SessionInfo {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    remember: Boolean(Number(r.remember)),
    user_agent: (r.user_agent as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    created_at: String(r.created_at),
    last_seen_at: String(r.last_seen_at),
    expires_at: String(r.expires_at),
  }
}

export async function listSessions(userId: number): Promise<SessionInfo[]> {
  await sql.run('DELETE FROM sessions WHERE expires_at <= ?', [sql.nowIso()])
  const rows = await sql.all('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', [userId])
  return rows.map(toSession)
}

export async function revokeSession(userId: number, sessionId: number): Promise<boolean> {
  return (await sql.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId])) > 0
}

export async function revokeToken(token: string): Promise<void> {
  if (token) await sql.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)])
}

export async function revokeOtherSessions(userId: number, keepSessionId: number | null): Promise<number> {
  return keepSessionId
    ? sql.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [userId, keepSessionId])
    : sql.run('DELETE FROM sessions WHERE user_id = ?', [userId])
}

// ---------- account management ----------

async function requirePassword(userId: number, password: string): Promise<Record<string, unknown>> {
  const row = await sql.one('SELECT * FROM users WHERE id = ?', [userId])
  if (!row) throw new AuthError(404, 'Account not found.')
  if (!(await verifyPasswordHash(password, String(row.password_hash)))) {
    throw new AuthError(400, 'Your current password is incorrect.')
  }
  return row
}

export async function changePassword(userId: number, current: string, next: string, keepSessionId: number | null): Promise<void> {
  const row = await requirePassword(userId, current)
  const problem = passwordProblem(next, { email: String(row.email), name: String(row.name) })
  if (problem) throw new AuthError(400, problem)
  if (current === next) throw new AuthError(400, 'Pick a password different from the current one.')
  const now = sql.nowIso()
  await sql.run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?', [
    await hashPassword(next), now, now, userId,
  ])
  await revokeOtherSessions(userId, keepSessionId)
}

export async function updateProfile(userId: number, input: { name?: string; email?: string; password?: string }): Promise<User> {
  const user = await getUser(userId)
  if (!user) throw new AuthError(404, 'Account not found.')
  const { name, email } = validateIdentity(input.name ?? user.name, input.email ?? user.email)
  if (email !== user.email) {
    if (!input.password) throw new AuthError(400, 'Enter your password to change your email.')
    await requirePassword(userId, input.password)
    const taken = await userRowByEmail(email)
    if (taken && Number(taken.id) !== userId) throw new AuthError(409, 'That email is already in use.')
  }
  await sql.run('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?', [name, email, sql.nowIso(), userId])
  return (await getUser(userId))!
}

export async function regenerateRecoveryCode(userId: number, password: string): Promise<string> {
  await requirePassword(userId, password)
  const code = newRecoveryCode()
  await sql.run('UPDATE users SET recovery_hash = ?, updated_at = ? WHERE id = ?', [
    await hashPassword(normRecovery(code)), sql.nowIso(), userId,
  ])
  return code
}

// ---------- forgot password ----------

/**
 * Create a 6-digit reset code for `email`. Returns it (for the caller to email)
 * or null when there's no such account — callers must answer the same way in
 * both cases so the form doesn't reveal which emails exist.
 */
export async function createResetCode(email: string): Promise<{ code: string; user: User } | null> {
  const row = await userRowByEmail(email)
  if (!row) return null
  const userId = Number(row.id)
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const now = Date.now()
  await sql.run("UPDATE auth_codes SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL", [new Date(now).toISOString(), userId])
  await sql.insert(
    `INSERT INTO auth_codes (user_id, purpose, code_hash, attempts, expires_at, created_at) VALUES (?, 'reset', ?, 0, ?, ?)`,
    [userId, sha256(`${userId}:${code}`), new Date(now + RESET_CODE_TTL_MS).toISOString(), new Date(now).toISOString()],
  )
  return { code, user: toUser(row)! }
}

/**
 * Set a new password using an emailed code or the recovery code. Signs out
 * every device. Using the recovery code burns it and returns a fresh one.
 */
export async function resetPassword(input: {
  email: string
  password: string
  code?: string
  recoveryCode?: string
  meta?: ClientMeta
}): Promise<{ user: User; newRecoveryCode: string | null }> {
  const keys = bucketKeys(input.email, input.meta?.ip)
  const wait = lockedFor(keys)
  if (wait) throw lockError(wait)
  const row = await userRowByEmail(input.email)
  const fail = (msg: string): never => {
    recordFailure(keys)
    const after = lockedFor(keys)
    if (after) throw lockError(after)
    throw new AuthError(400, msg)
  }
  if (!row) return fail('That code isn’t valid for this email.')
  const userId = Number(row.id)
  let usedRecovery = false

  if (input.recoveryCode) {
    const ok = row.recovery_hash && (await verifyPasswordHash(normRecovery(input.recoveryCode), String(row.recovery_hash)))
    if (!ok) return fail('That recovery code isn’t right. Check for typos — dashes and case don’t matter.')
    usedRecovery = true
  } else {
    const code = (input.code || '').replace(/\D/g, '')
    const c = await sql.one(
      "SELECT * FROM auth_codes WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL ORDER BY id DESC LIMIT 1",
      [userId],
    )
    if (!c || Date.parse(String(c.expires_at)) < Date.now()) return fail('That code has expired. Request a new one.')
    if (Number(c.attempts) >= RESET_MAX_ATTEMPTS) return fail('Too many wrong codes. Request a new one.')
    if (!safeEqualHex(sha256(`${userId}:${code}`), String(c.code_hash))) {
      await sql.run('UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?', [Number(c.id)])
      return fail('That code isn’t right.')
    }
    await sql.run('UPDATE auth_codes SET used_at = ? WHERE id = ?', [sql.nowIso(), Number(c.id)])
  }

  const problem = passwordProblem(input.password, { email: String(row.email), name: String(row.name) })
  if (problem) throw new AuthError(400, problem)
  const now = sql.nowIso()
  let fresh: string | null = null
  if (usedRecovery) {
    fresh = newRecoveryCode()
    await sql.run('UPDATE users SET recovery_hash = ? WHERE id = ?', [await hashPassword(normRecovery(fresh)), userId])
  }
  await sql.run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?', [
    await hashPassword(input.password), now, now, userId,
  ])
  await revokeOtherSessions(userId, null)
  clearFailures(input.email)
  return { user: (await getUser(userId))!, newRecoveryCode: fresh }
}

/** For `npm run auth:recover` on the machine itself: issue a fresh recovery code. */
export async function issueRecoveryCodeFor(email: string | null): Promise<{ email: string; code: string } | null> {
  const row = email
    ? await userRowByEmail(email)
    : await sql.one('SELECT * FROM users ORDER BY id LIMIT 1')
  if (!row) return null
  const code = newRecoveryCode()
  await sql.run('UPDATE users SET recovery_hash = ? WHERE id = ?', [await hashPassword(normRecovery(code)), Number(row.id)])
  return { email: String(row.email), code }
}

// ---------- request helpers ----------

export function bearerFrom(header: string | null): string | null {
  if (!header) return null
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

function cookieFrom(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

export interface RequestToken {
  token: string
  via: 'cookie' | 'bearer' | 'query'
}

/** Session token from the cookie, an Authorization header, or ?token= on live streams. */
export function tokenFromRequest(req: Request): RequestToken | null {
  const bearer = bearerFrom(req.headers.get('authorization'))
  if (bearer) return { token: bearer, via: 'bearer' }
  const cookie = cookieFrom(req.headers.get('cookie'), SESSION_COOKIE)
  if (cookie) return { token: cookie, via: 'cookie' }
  const url = new URL(req.url)
  if (url.pathname.endsWith('/stream')) {
    const q = url.searchParams.get('token')
    if (q) return { token: q, via: 'query' }
  }
  return null
}

export async function sessionFromRequest(req: Request): Promise<{ session: SessionInfo; user: User; token: string } | null> {
  const t = tokenFromRequest(req)
  if (!t) return null
  const s = await resolveSession(t.token)
  return s ? { ...s, token: t.token } : null
}

export function clientMeta(req: Request): ClientMeta {
  const fwd = req.headers.get('x-forwarded-for')
  return {
    userAgent: req.headers.get('user-agent'),
    ip: (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip') || '').trim() || null,
  }
}

function isHttps(req: Request): boolean {
  return new URL(req.url).protocol === 'https:' || (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https'
}

export function sessionCookie(req: Request, token: string, remember: boolean, expiresAt: Date): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  // Without "remember me" it's a browser-session cookie; the server also
  // expires it after 12 idle hours.
  if (remember) parts.push(`Expires=${expiresAt.toUTCString()}`, `Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}`)
  if (isHttps(req)) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie(req: Request): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`
}

/**
 * Cross-site request check for cookie-authenticated writes: the browser sends
 * Sec-Fetch-Site / Origin, and they must say the request came from this app.
 */
export function isCrossSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site) return !(site === 'same-origin' || site === 'none')
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
    return new URL(origin).host !== host
  } catch {
    return true
  }
}
