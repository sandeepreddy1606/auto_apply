import { createResetCode, isValidEmail, normalizeEmail } from '@/lib/server/auth'
import { authHandler, str } from '@/lib/server/auth-http'
import { HttpError, json, readJson } from '@/lib/server/http'
import { sendEmail } from '@/lib/server/mailer'
import { load } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

/**
 * Email a 6-digit reset code. Answers the same whether or not the account
 * exists, so the form can't be used to discover emails.
 */
export const POST = authHandler(async (req: Request) => {
  const email = normalizeEmail(str((await readJson<Record<string, unknown>>(req)).email))
  if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
  const smtp = load().smtp
  if (!(smtp.host && smtp.username && smtp.password)) {
    throw new HttpError(400, 'Email isn’t set up in this app, so a code can’t be sent. Use your recovery code instead.')
  }
  const issued = await createResetCode(email)
  if (issued) {
    try {
      await sendEmail(
        smtp,
        issued.user.email,
        `Your Auto Apply reset code: ${issued.code}`,
        `Hi ${issued.user.name || 'there'},\n\nYour code to reset your Auto Apply password is:\n\n    ${issued.code}\n\nIt expires in 15 minutes. If you didn’t ask for this, ignore this email — your password hasn’t changed.\n`,
      )
    } catch (e) {
      console.error('[autoapply.auth] reset email failed:', e)
      throw new HttpError(502, 'Couldn’t send the email. Check Settings → SMTP, or use your recovery code.')
    }
  }
  return json({ ok: true })
})
