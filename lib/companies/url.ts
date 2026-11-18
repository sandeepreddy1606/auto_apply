import { HttpError } from '@/lib/server/http'

/** "stripe.com/jobs" → "https://stripe.com/jobs"; rejects things that aren't URLs. */
export function normalizeCareerUrl(raw: string): string {
  let url = (raw || '').trim().replace(/^"|"$/g, '')
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new HttpError(400, "That doesn't look like a valid URL.")
  }
  if (!parsed.host || !parsed.host.includes('.')) {
    throw new HttpError(400, "That doesn't look like a valid URL.")
  }
  return url.replace(/\/+$/, '')
}

/** A readable company name from a host: "careers.acme-corp.com" → "Acme Corp". */
export function nameFromHost(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.')
  const skip = new Set(['careers', 'jobs', 'job', 'apply', 'boards', 'job-boards', 'work', 'hire', 'en', 'in', 'us'])
  const core = parts.slice(0, -1).find((p) => !skip.has(p)) ?? parts[0]
  return core.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}
