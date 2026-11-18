import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'

import { profileHasGoogleSession } from '../lib/apply/google-account.ts'

// A Chromium-shaped cookie database with the given (host, name, expires) rows.
function profileWith(rows: [string, string, number][]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gacct-'))
  fs.mkdirSync(path.join(dir, 'Default', 'Network'), { recursive: true })
  const db = new DatabaseSync(path.join(dir, 'Default', 'Network', 'Cookies'))
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, expires_utc INTEGER, encrypted_value BLOB)')
  const ins = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, x\'00\')')
  for (const r of rows) ins.run(...r)
  db.close()
  return dir
}
const chromeTime = (ms: number) => (ms + 11_644_473_600_000) * 1000

describe('Google sign-in check', () => {
  test('signed in: Google session cookie present and unexpired', async () => {
    const dir = profileWith([['.google.com', '__Secure-1PSID', chromeTime(Date.now() + 86_400_000)], ['.youtube.com', 'PREF', 0]])
    assert.equal(await profileHasGoogleSession(dir), true)
  })
  test('not signed in: only consent / tracking cookies', async () => {
    const dir = profileWith([['.google.com', 'NID', chromeTime(Date.now() + 86_400_000)], ['.google.com', 'AEC', 0]])
    assert.equal(await profileHasGoogleSession(dir), false)
  })
  test('not signed in: the session cookie has expired', async () => {
    const dir = profileWith([['.google.com', 'SID', chromeTime(Date.now() - 1000)]])
    assert.equal(await profileHasGoogleSession(dir), false)
  })
  test('a fresh profile folder with no cookies yet is "not signed in"; a missing one is unknown', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gacct-'))
    assert.equal(await profileHasGoogleSession(dir), false)
    assert.equal(await profileHasGoogleSession(path.join(dir, 'nope')), null)
  })
})
