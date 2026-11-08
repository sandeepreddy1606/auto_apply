/** Shared HTTP helpers for job boards: browser-like UA, timeouts, per-host pacing. */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT_MS = 25_000
const HOST_GAP_MS = 1000

/** Hosts that ask for a gentler pace than the default. */
const SLOW_HOSTS: Record<string, number> = { 'apply.careers.microsoft.com': 3000 }

const lastHit = new Map<string, number>()

/** At most one request per second per host (slower for some), so a scan never hammers a site. */
async function pace(url: string): Promise<void> {
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    return
  }
  const gap = SLOW_HOSTS[host] ?? HOST_GAP_MS
  const wait = (lastHit.get(host) ?? 0) + gap - Date.now()
  lastHit.set(host, Math.max(Date.now(), (lastHit.get(host) ?? 0) + gap))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

/** Seconds from a Retry-After header (delta or HTTP date), or null. */
function retryAfterSeconds(v: string | null): number | null {
  if (!v) return null
  if (/^\d+$/.test(v.trim())) return Number(v.trim())
  const t = Date.parse(v)
  return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 1000)) : null
}

export class HttpStatusError extends Error {
  status: number

  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

export async function httpGet(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await pace(url)
    const r = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.8', ...(init.headers || {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (r.ok) return r
    // "Too many requests": wait as long as the site asks (if it says, and
    // briefly), once. Otherwise stop and report it.
    const wait = r.status === 429 || r.status === 503 ? retryAfterSeconds(r.headers.get('retry-after')) : null
    if (attempt === 0 && wait !== null && wait <= 30) {
      await new Promise((res) => setTimeout(res, (wait + 1) * 1000))
      continue
    }
    throw new HttpStatusError(r.status, url)
  }
}

export const getJson = async (url: string): Promise<unknown> => (await httpGet(url)).json()
export const getText = async (url: string): Promise<string> => (await httpGet(url)).text()

export async function postJson(url: string, body: unknown): Promise<unknown> {
  const r = await httpGet(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const prop = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined

/** Epoch millis / ISO / date-ish → ISO string, or null. */
export function toIso(v: unknown): string | null {
  if (v == null || v === '') return null
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Workday's "Posted 3 Days Ago" / "Posted Today" / "Posted 30+ Days Ago". */
export function relativePostedToIso(s: string, now = new Date()): string | null {
  const t = (s || '').toLowerCase()
  let days: number | null = null
  if (/today/.test(t)) days = 0
  else if (/yesterday/.test(t)) days = 1
  else {
    const m = /(\d+)\+?\s*days?/.exec(t)
    if (m) days = Number(m[1])
  }
  if (days === null) return null
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}
