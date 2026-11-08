/**
 * Upgrading from the old single dashboard password (data/auth.json, PBKDF2)
 * to an account. Own file so it gets its own fresh data directory.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-legacy-'))
process.env.AUTO_APPLY_DATA_DIR = tmpDir

// Exactly what the old build wrote: it trimmed the password before hashing.
const salt = crypto.randomBytes(16)
fs.writeFileSync(
  path.join(tmpDir, 'auth.json'),
  JSON.stringify({
    salt: salt.toString('hex'),
    hash: crypto.pbkdf2Sync('my old password', salt, 200_000, 32, 'sha256').toString('hex'),
    secret: crypto.randomBytes(32).toString('hex'),
    created_at: 1_700_000_000,
  }),
)

const auth = await import('../lib/server/auth.ts')

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* Windows may still hold the SQLite file */
  }
})

describe('auth: upgrading the old single password', () => {
  test('an old auth.json means "upgrade", and plain sign-up is refused', async () => {
    assert.equal(await auth.setupState(), 'upgrade')
    await assert.rejects(
      auth.signUp({ name: 'Ada', email: 'ada@example.com', password: 'whatever pass' }),
      (e: Error & { status?: number }) => e.status === 409,
    )
  })

  test('the wrong old password is rejected', async () => {
    await assert.rejects(
      auth.upgradeLegacy({ currentPassword: 'nope', name: 'Ada', email: 'ada@example.com' }),
      /isn.t your current dashboard password/,
    )
  })

  test('upgrade keeps the old password, creates the account, retires auth.json', async () => {
    const out = await auth.upgradeLegacy({ currentPassword: 'my old password', name: 'Ada', email: 'Ada@Example.com' })
    assert.equal(out.user.email, 'ada@example.com')
    assert.ok(out.recoveryCode)
    assert.equal(await auth.setupState(), 'login')
    assert.equal(fs.existsSync(path.join(tmpDir, 'auth.json')), false)
    assert.equal(fs.existsSync(path.join(tmpDir, 'auth.json.migrated')), true)
    assert.ok(await auth.login('ada@example.com', 'my old password'))
  })
})
