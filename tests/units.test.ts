/**
 * Unit tests for behaviour that has no Python counterpart to diff against:
 * accounts, sessions and password reset, and the settings merge/sanitise rules.
 *
 * Both touch the data directory, so they run against a throwaway
 * AUTO_APPLY_DATA_DIR set before the modules are imported.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-test-'))
process.env.AUTO_APPLY_DATA_DIR = tmpDir

// Imported after the env var is set — paths.ts reads it at module load.
const auth = await import('../lib/server/auth.ts')
const settings = await import('../lib/server/settings.ts')

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* Windows may still hold the SQLite file */
  }
})

type Coded = Error & { status?: number }
const status = (n: number) => (e: Coded) => e.status === n

describe('auth: accounts and sessions', () => {
  const EMAIL = 'ada@example.com'
  const PW = 'correct horse battery'
  let recovery = ''

  test('password rules give friendly reasons', () => {
    assert.match(auth.passwordProblem('abc') ?? '', /at least 8/)
    assert.match(auth.passwordProblem('password123') ?? '', /too common/)
    assert.match(auth.passwordProblem('aaaaaaaaaa') ?? '', /repeated/)
    assert.match(auth.passwordProblem('ada@example.com', { email: EMAIL }) ?? '', /email/)
    assert.equal(auth.passwordProblem(PW, { email: EMAIL }), null)
  })

  test('scrypt hashes verify; old PBKDF2 hashes still verify', async () => {
    const h = await auth.hashPassword('s3cret-pass')
    assert.match(h, /^scrypt\$/)
    assert.equal(await auth.verifyPasswordHash('s3cret-pass', h), true)
    assert.equal(await auth.verifyPasswordHash('wrong', h), false)
    assert.equal(await auth.verifyPasswordHash('x', 'garbage'), false)
    const salt = crypto.randomBytes(16)
    const digest = crypto.pbkdf2Sync('old pass', salt, 200000, 32, 'sha256').toString('hex')
    const legacy = ['pbkdf2', '200000', salt.toString('hex'), digest].join('$')
    assert.equal(await auth.verifyPasswordHash('old pass', legacy), true)
    assert.equal(await auth.verifyPasswordHash('old pas', legacy), false)
  })

  test('first run shows sign-up; sign-up validates input', async () => {
    assert.equal(await auth.setupState(), 'signup')
    await assert.rejects(auth.signUp({ name: '', email: EMAIL, password: PW }), /your name/)
    await assert.rejects(auth.signUp({ name: 'Ada', email: 'not-an-email', password: PW }), /valid email/)
    await assert.rejects(auth.signUp({ name: 'Ada', email: EMAIL, password: 'short' }), /at least 8/)
  })

  test('sign-up creates the owner, then closes', async () => {
    const out = await auth.signUp({ name: ' Ada  Lovelace ', email: ' ADA@Example.com ', password: PW })
    recovery = out.recoveryCode
    assert.equal(out.user.email, EMAIL, 'email normalised')
    assert.equal(out.user.name, 'Ada Lovelace')
    assert.match(recovery, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)
    assert.equal(await auth.setupState(), 'login')
    await assert.rejects(auth.signUp({ name: 'Eve', email: 'eve@example.com', password: PW }), status(403))
  })

  test('login: right password works (any email case), wrong is rejected', async () => {
    auth._resetRateLimits()
    const u = await auth.login('Ada@Example.COM', PW)
    assert.equal(u.email, EMAIL)
    assert.ok(u.last_login_at)
    await assert.rejects(auth.login(EMAIL, 'nope nope'), /don.t match/)
    await assert.rejects(auth.login('nobody@example.com', PW), /don.t match/)
  })

  test('login locks after repeated failures', async () => {
    auth._resetRateLimits()
    for (let i = 0; i < 4; i++) await assert.rejects(auth.login(EMAIL, 'wrong-pass'), /don.t match/)
    await assert.rejects(auth.login(EMAIL, 'wrong-pass'), (e: Coded) => e.status === 429 && /Too many attempts/.test(e.message))
    // Even the right password waits out the lock.
    await assert.rejects(auth.login(EMAIL, PW), status(429))
    auth._resetRateLimits()
    assert.ok(await auth.login(EMAIL, PW))
  })

  test('sessions: create, resolve, revoke; tampered tokens fail cleanly', async () => {
    const u = await auth.login(EMAIL, PW)
    const a = await auth.createSession(u.id, true, { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', ip: '10.0.0.2' })
    const b = await auth.createSession(u.id, false)
    assert.equal((await auth.resolveSession(a.token))?.user.email, EMAIL)
    assert.equal(await auth.resolveSession(`${a.token}x`), null)
    assert.equal(await auth.resolveSession(null), null)
    assert.equal(await auth.resolveSession('é.é'), null)
    assert.ok(b.expiresAt.getTime() - Date.now() <= auth.SHORT_TTL_MS + 1000, 'short session ~12h')
    assert.ok(a.expiresAt.getTime() - Date.now() > 29 * 24 * 3600 * 1000, 'remembered session ~30d')
    const list = await auth.listSessions(u.id)
    assert.ok(list.some((s) => s.id === a.id && s.ip === '10.0.0.2'))
    assert.equal(await auth.revokeSession(u.id, b.id), true)
    assert.equal(await auth.resolveSession(b.token), null)
    await auth.revokeOtherSessions(u.id, a.id)
    assert.ok(await auth.resolveSession(a.token), 'kept session survives "sign out others"')
  })

  test('changing the password signs out other devices only', async () => {
    const u = await auth.login(EMAIL, PW)
    const keep = await auth.createSession(u.id, true)
    const other = await auth.createSession(u.id, true)
    await assert.rejects(auth.changePassword(u.id, 'wrong', 'another good pass', keep.id), /current password is incorrect/)
    await assert.rejects(auth.changePassword(u.id, PW, PW, keep.id), /different/)
    await auth.changePassword(u.id, PW, 'another good pass', keep.id)
    assert.ok(await auth.resolveSession(keep.token))
    assert.equal(await auth.resolveSession(other.token), null)
    assert.ok(await auth.login(EMAIL, 'another good pass'))
    await auth.changePassword(u.id, 'another good pass', PW, keep.id)
  })

  test('changing the email needs the password', async () => {
    const u = await auth.login(EMAIL, PW)
    await assert.rejects(auth.updateProfile(u.id, { email: 'ada2@example.com' }), /password to change your email/)
    const r = await auth.updateProfile(u.id, { name: 'Ada L', email: 'ada2@example.com', password: PW })
    assert.equal(r.email, 'ada2@example.com')
    await auth.updateProfile(u.id, { email: EMAIL, password: PW })
  })

  test('reset with the recovery code: burns it, issues a new one, signs everyone out', async () => {
    auth._resetRateLimits()
    const u = await auth.login(EMAIL, PW)
    const s = await auth.createSession(u.id, true)
    await assert.rejects(
      auth.resetPassword({ email: EMAIL, recoveryCode: 'AAAA-BBBB-CCCC-DDDD', password: 'brand new pass' }),
      /recovery code isn.t right/,
    )
    // Case, spaces and dashes don't matter.
    const typed = recovery.toLowerCase().replace(/-/g, ' ')
    const out = await auth.resetPassword({ email: EMAIL, recoveryCode: typed, password: 'brand new pass' })
    assert.ok(out.newRecoveryCode && out.newRecoveryCode !== recovery)
    assert.equal(await auth.resolveSession(s.token), null)
    await assert.rejects(
      auth.resetPassword({ email: EMAIL, recoveryCode: recovery, password: 'third new pass' }),
      /isn.t right/,
      'old code burned',
    )
    recovery = out.newRecoveryCode!
    assert.ok(await auth.login(EMAIL, 'brand new pass'))
  })

  test('reset with an emailed code: single use, wrong codes rejected', async () => {
    auth._resetRateLimits()
    assert.equal(await auth.createResetCode('nobody@example.com'), null)
    const issued = (await auth.createResetCode(EMAIL))!
    assert.match(issued.code, /^\d{6}$/)
    const wrong = issued.code === '000000' ? '111111' : '000000'
    await assert.rejects(auth.resetPassword({ email: EMAIL, code: wrong, password: PW }), /isn.t right/)
    await auth.resetPassword({ email: EMAIL, code: issued.code, password: PW })
    await assert.rejects(auth.resetPassword({ email: EMAIL, code: issued.code, password: PW }), /expired|isn.t right/, 'single use')
    assert.ok(await auth.login(EMAIL, PW))
  })

  test('issueRecoveryCodeFor (npm run auth:recover) replaces the code', async () => {
    const out = (await auth.issueRecoveryCodeFor(null))!
    assert.equal(out.email, EMAIL)
    auth._resetRateLimits()
    await assert.rejects(auth.resetPassword({ email: EMAIL, recoveryCode: recovery, password: PW }), /isn.t right/)
    assert.ok((await auth.resetPassword({ email: EMAIL, recoveryCode: out.code, password: PW })).newRecoveryCode)
  })

  test('request helpers: bearer, cookie, stream query; cross-site detection; cookie flags', () => {
    assert.equal(auth.bearerFrom('Bearer abc'), 'abc')
    assert.equal(auth.bearerFrom('bearer abc'), 'abc')
    assert.equal(auth.bearerFrom('Basic abc'), null)
    assert.equal(auth.bearerFrom(null), null)
    const mk = (url: string, h: Record<string, string>) => new Request(url, { headers: h })
    assert.deepEqual(auth.tokenFromRequest(mk('http://x/api/a', { cookie: 'a=1; aa_session=tok123' })), { token: 'tok123', via: 'cookie' })
    assert.deepEqual(auth.tokenFromRequest(mk('http://x/api/a', { authorization: 'Bearer t', cookie: 'aa_session=c' })), { token: 't', via: 'bearer' })
    assert.deepEqual(auth.tokenFromRequest(mk('http://x/api/apply/1/stream?token=q', {})), { token: 'q', via: 'query' })
    assert.equal(auth.tokenFromRequest(mk('http://x/api/jobs?token=q', {})), null, '?token= only on streams')
    assert.equal(auth.isCrossSite(mk('http://x/api/a', { 'sec-fetch-site': 'cross-site' })), true)
    assert.equal(auth.isCrossSite(mk('http://x/api/a', { 'sec-fetch-site': 'same-origin' })), false)
    assert.equal(auth.isCrossSite(mk('http://x:8787/api/a', { origin: 'http://evil.test', host: 'x:8787' })), true)
    assert.equal(auth.isCrossSite(mk('http://x:8787/api/a', { origin: 'http://x:8787', host: 'x:8787' })), false)
    assert.equal(auth.isCrossSite(mk('http://x/api/a', {})), false, 'no browser headers (curl/scripts)')
    const c = auth.sessionCookie(mk('https://x/api', {}), 'tok', true, new Date(Date.now() + 60_000))
    assert.match(c, /HttpOnly/)
    assert.match(c, /SameSite=Lax/)
    assert.match(c, /Secure/)
    assert.match(c, /Max-Age=\d+/)
    assert.doesNotMatch(auth.sessionCookie(mk('http://x/api', {}), 'tok', false, new Date()), /Max-Age|Secure/)
  })
})

describe('settings', () => {
  test('load returns defaults when nothing is saved', () => {
    const s = settings.load()
    assert.equal(s.smtp.port, 587)
    assert.equal(s.companies.scan_interval_minutes, 180)
    assert.deepEqual(s.resumes, [])
  })

  test('save deep-merges without dropping sibling sections', () => {
    settings.save({ profile: { full_name: 'Ada' } as never })
    settings.save({ smtp: { username: 'ada@example.com' } as never })
    const s = settings.load()
    assert.equal(s.profile.full_name, 'Ada')
    assert.equal(s.smtp.username, 'ada@example.com')
    assert.equal(s.smtp.host, 'smtp.gmail.com') // untouched default survives
  })

  test('sanitises ports, intervals and quoted windows paths', () => {
    const s = settings.save({
      smtp: { port: '70000' } as never,
      companies: { scan_interval_minutes: '5' } as never,
      profile: { resume_path: '"C:\\cv.pdf"  ' } as never,
    })
    assert.equal(s.smtp.port, 587) // out of range -> default
    assert.equal(s.companies.scan_interval_minutes, 15) // clamped to the minimum
    assert.equal(s.profile.resume_path, 'C:\\cv.pdf')

    assert.equal(settings.save({ companies: { scan_interval_minutes: 99999 } as never })
      .companies.scan_interval_minutes, 1440) // clamped to the maximum
    assert.equal(settings.save({ smtp: { port: '465' } as never }).smtp.port, 465)
  })

  test('trims string fields', () => {
    const s = settings.save({ profile: { email: '  ada@example.com  ' } as never })
    assert.equal(s.profile.email, 'ada@example.com')
  })
})
