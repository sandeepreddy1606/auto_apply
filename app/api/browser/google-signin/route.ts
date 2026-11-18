import { browserKind, chromeExecutable, profileDir } from '@/lib/apply/browser-choice'
import { profileHasGoogleSession } from '@/lib/apply/google-account'
import { handler, json } from '@/lib/server/http'
import { enqueue, kvGet } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/**
 * "Sign in to Google": opens the automation browser's profile as a normal
 * window at Google's sign-in page. Sign in there and close the window; Google
 * Forms that need an account then open signed in.
 */
export const POST = handler(async () => json({ task_id: await enqueue('browser.google_signin', {}, { dedupeKey: 'google-signin', maxAttempts: 1 }) }))

type Last = { state: string; at: string; message?: string; browser?: string }

/**
 * state: never | open | signed_in | not_signed_in | timed_out | busy | failed
 * signed_in: checked live in the profile now (null = the browser has it locked;
 * then the result of the last sign-in stands).
 */
export const GET = handler(async () => {
  const last = (await kvGet<Last>('google.signin'))?.value ?? { state: 'never', at: null }
  const live = last.state === 'open' ? null : await profileHasGoogleSession(profileDir()).catch(() => null)
  // Older builds recorded "done" when the window closed, without checking.
  const lastSaysSigned = last.state === 'signed_in' || last.state === 'done'
  return json({
    ...last,
    signed_in: live ?? (last.state === 'open' ? null : lastSaysSigned),
    browser: browserKind(),
    chrome_available: Boolean(chromeExecutable()),
  })
})
