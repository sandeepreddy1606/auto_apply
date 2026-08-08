/**
 * Unit tests for behaviour that has no Python counterpart to diff against:
 * the auth token scheme and the settings merge/sanitise rules.
 *
 * Both touch the data directory, so they run against a throwaway
 * AUTO_APPLY_DATA_DIR set before the modules are imported.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-test-'))
process.env.AUTO_APPLY_DATA_DIR = tmpDir

// Imported after the env var is set — paths.ts reads it at module load.
const auth = await import('../lib/server/auth.ts')
const settings = await import('../lib/server/settings.ts')

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

describe('auth', () => {
  before(() => auth.setPassword('correct horse'))

  test('rejects a short password', () => {
    assert.throws(() => auth.setPassword('abc'), /at least 6 characters/)
  })

  test('verifies the right password and rejects the wrong one', () => {
    assert.equal(auth.isPasswordSet(), true)
    assert.equal(auth.verifyPassword('correct horse'), true)
    assert.equal(auth.verifyPassword('wrong horse'), false)
    assert.equal(auth.verifyPassword(''), false)
  })

  test('issues a token that verifies, and rejects tampered ones', () => {
    const token = auth.issueToken()
    assert.equal(auth.verifyToken(token), true)
    assert.equal(auth.verifyToken(`${token}x`), false)
    assert.equal(auth.verifyToken(null), false)
    assert.equal(auth.verifyToken(''), false)
    assert.equal(auth.verifyToken('garbage'), false)
    // A non-ASCII header must yield false, never an exception.
    assert.equal(auth.verifyToken('é.é'), false)
  })

  test('changing the password rotates the secret and invalidates old tokens', () => {
    const old = auth.issueToken()
    assert.equal(auth.verifyToken(old), true)
    auth.changePassword('correct horse', 'new passphrase')
    assert.equal(auth.verifyToken(old), false)
    assert.equal(auth.verifyPassword('new passphrase'), true)
    assert.equal(auth.verifyToken(auth.issueToken()), true)
  })

  test('bearerFrom parses only bearer headers', () => {
    assert.equal(auth.bearerFrom('Bearer abc'), 'abc')
    assert.equal(auth.bearerFrom('bearer abc'), 'abc')
    assert.equal(auth.bearerFrom('Basic abc'), null)
    assert.equal(auth.bearerFrom(null), null)
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
