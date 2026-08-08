import { HttpError, handler, json, readJson } from '@/lib/server/http'
import * as mailer from '@/lib/server/mailer'
import * as settingsStore from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ to?: string }>(req)
  const settings = settingsStore.load()
  try {
    await mailer.sendEmail(
      settings.smtp,
      body.to || '',
      'Auto Apply - test email',
      'This is a test email from your Auto Apply system. SMTP works!',
      settings.profile.resume_path || null,
    )
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
  return json({ ok: true })
})
