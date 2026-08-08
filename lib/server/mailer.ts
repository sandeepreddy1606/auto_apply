/** SMTP email sending with template rendering and resume attachment. */
import fs from 'node:fs'
import path from 'node:path'

import nodemailer from 'nodemailer'

import type { Application, Profile, SmtpConfig } from '@/lib/types'

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g

/** Replace {key} placeholders; unknown keys become empty strings. */
export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  const rendered = (template || '').replace(PLACEHOLDER_RE, (_, k: string) =>
    String(context[k] ?? ''),
  )
  // Drop lines like "LinkedIn:" / "- Notice period:" whose value came out empty.
  const kept = rendered
    .split('\n')
    .filter((line) => !/^\s*[-•]?\s*[A-Za-z ]{2,30}:\s*$/.test(line))
    .join('\n')
  return kept.replace(/\n{3,}/g, '\n\n').trim()
}

export function buildContext(
  profile: Partial<Profile>,
  application: Partial<Application>,
): Record<string, unknown> {
  return {
    ...profile,
    job_title: application.job_title || 'the advertised position',
    company: application.company || '',
    location: application.location || '',
    experience: application.experience || '',
  }
}

export async function sendEmail(
  smtpCfg: Partial<SmtpConfig>,
  toAddr: string,
  subject: string,
  body: string,
  attachmentPath?: string | null,
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

  const attachments: { filename: string; content: Buffer }[] = []
  if (attachmentPath) {
    const p = attachmentPath.trim().replace(/^"|"$/g, '')
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
      throw new Error(`Resume file not found: ${p}`)
    }
    // Read before opening the SMTP connection so a bad path fails fast.
    attachments.push({ filename: path.basename(p), content: fs.readFileSync(p) })
  }

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
      attachments,
    })
  } finally {
    transport.close()
  }
}
