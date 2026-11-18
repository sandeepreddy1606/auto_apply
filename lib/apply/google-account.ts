/**
 * Is the automation browser signed in to Google?
 *
 * Read from the profile's cookie database: Google's session cookies (SID,
 * __Secure-1PSID…) exist only while an account is signed in, and their names
 * and hosts are stored in plain text — nothing is decrypted and no password
 * or token is read. The browser locks that file while it runs, so the check
 * works on a copy and, when even that is refused, reports `null` (unknown)
 * instead of guessing.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SESSION_COOKIES = ['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID']

function cookieFiles(profileDir: string): string[] {
  return [
    path.join(profileDir, 'Default', 'Network', 'Cookies'),
    path.join(profileDir, 'Default', 'Cookies'),
  ].filter((f) => fs.existsSync(/*turbopackIgnore: true*/ f))
}

/** true = signed in, false = not signed in, null = couldn't tell (file locked / no profile yet). */
export async function profileHasGoogleSession(profileDir: string): Promise<boolean | null> {
  const files = cookieFiles(profileDir)
  if (!files.length) return fs.existsSync(profileDir) ? false : null
  const { DatabaseSync } = await import('node:sqlite')
  let unknown = false
  for (const file of files) {
    const tmp = path.join(os.tmpdir(), `autoapply-cookies-${process.pid}-${Date.now()}.db`)
    try {
      fs.copyFileSync(file, tmp)
      for (const ext of ['-wal', '-journal']) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, tmp + ext)
      const db = new DatabaseSync(tmp, { readOnly: true })
      try {
        // expires_utc is microseconds since 1601-01-01; 0 = session cookie.
        const nowChrome = (Date.now() + 11_644_473_600_000) * 1000
        const marks = SESSION_COOKIES.map(() => '?').join(',')
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n FROM cookies
             WHERE (host_key = '.google.com' OR host_key = 'accounts.google.com')
               AND name IN (${marks}) AND (expires_utc = 0 OR expires_utc > ?)`,
          )
          .get(...SESSION_COOKIES, nowChrome) as { n: number } | undefined
        if ((row?.n ?? 0) > 0) return true
      } finally {
        db.close()
      }
    } catch {
      unknown = true
    } finally {
      for (const f of [tmp, `${tmp}-wal`, `${tmp}-journal`]) fs.rmSync(f, { force: true })
    }
  }
  return unknown ? null : false
}

/** Same question asked of a running browser context (when the file is locked by it). */
export async function contextHasGoogleSession(ctx: { cookies(urls: string[]): Promise<{ name: string; expires: number }[]> }): Promise<boolean> {
  const cookies = await ctx.cookies(['https://accounts.google.com', 'https://www.google.com', 'https://docs.google.com'])
  const now = Date.now() / 1000
  return cookies.some((c) => SESSION_COOKIES.includes(c.name) && (c.expires === -1 || c.expires > now))
}
