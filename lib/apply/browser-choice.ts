/**
 * Which browser the automation uses, and where its profile lives.
 *
 *   chromium — Playwright's bundled Chromium (default; nothing else to install)
 *   chrome   — your installed Google Chrome. Use it when Google refuses to
 *              sign in in the bundled one ("This browser or app may not be
 *              secure"): Chrome is a browser Google supports.
 *
 * Each has its own profile folder. A profile is tied to the browser that
 * created it (Chrome encrypts its cookies for its own executable on Windows),
 * so switching browsers never reuses — and never damages — the other one's.
 * Neither is your everyday Chrome profile.
 *
 * Kept free of Playwright imports so API routes can use it.
 */
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/lib/server/paths'
import * as settingsStore from '@/lib/server/settings'

export type BrowserKind = 'chromium' | 'chrome'

export function browserKind(): BrowserKind {
  return settingsStore.load().apply_automation.browser === 'chrome' && chromeExecutable() ? 'chrome' : 'chromium'
}

export function profileDir(kind: BrowserKind = browserKind()): string {
  return path.join(DATA_DIR, kind === 'chrome' ? 'browser-profile-chrome' : 'browser-profile')
}

/** The installed Google Chrome, or null. */
export function chromeExecutable(): string | null {
  const env = process.env
  const candidates =
    process.platform === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
          .filter(Boolean)
          .map((d) => path.join(d!, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']
  return candidates.find((p) => fs.existsSync(p)) ?? null
}
