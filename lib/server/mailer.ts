/** SMTP email sending — used for account emails (the password-reset code). */
import nodemailer from 'nodemailer'

import type { SmtpConfig } from '@/lib/types'

export async function sendEmail(
  smtpCfg: Partial<SmtpConfig>,
  toAddr: string,
  subject: string,
  body: string,
): Promise<void> {
  const host = (smtpCfg.host || '').trim()
  const port = Number(smtpCfg.port || 587)
  const username = (smtpCfg.username || '').trim()
  const password = smtpCfg.password || ''
  const fromName = (smtpCfg.from_name || '').trim()

  if (!host || !username || !password) {
    throw new Error('SMTP is not configured. Set host/username/password in Settings.')
  }
  if (!toAddr) throw new Error('No recipient email address.')

  const secure = Boolean(smtpCfg.use_ssl) || port === 465
  const transport = nodemailer.createTransport({
    host,
    port,
    secure, // true => implicit TLS (465); false => STARTTLS upgrade
    requireTLS: !secure,
    auth: { user: username, pass: password },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  })

  try {
    await transport.sendMail({
      from: fromName ? { name: fromName, address: username } : username,
      to: toAddr,
      subject,
      text: body,
    })
  } finally {
    transport.close()
  }
}
