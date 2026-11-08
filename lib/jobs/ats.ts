/**
 * ATS detection from a URL and (optionally) page HTML. Pure.
 *
 * The token is what each board's public API keys on: the Greenhouse board
 * name, Lever/Ashby/Workable account, SmartRecruiters company, or for Workday
 * "tenant/site" plus the host.
 */
import type { AtsType } from '@/lib/types'

export interface AtsInfo {
  type: AtsType
  token: string | null
  host: string | null
}

const LOCALE_RE = /^[a-z]{2}-[A-Z]{2}$/

/** Workday career URL → host, tenant and site (e.g. nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite). */
export function parseWorkday(url: string): { host: string; tenant: string; site: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const m = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i.exec(u.host)
  if (!m) return null
  const segs = u.pathname.split('/').filter(Boolean)
  // Optional locale prefix (/en-US/Site/...) and the /wday/cxs/ API form.
  if (segs[0] === 'wday' && segs[1] === 'cxs' && segs.length >= 4) {
    return { host: u.host, tenant: segs[2], site: segs[3] }
  }
  const rest = LOCALE_RE.test(segs[0] || '') ? segs.slice(1) : segs
  const site = rest[0]
  if (!site || site === 'job') return null
  return { host: u.host, tenant: m[1], site }
}

const firstSeg = (u: URL): string | null => u.pathname.split('/').filter(Boolean)[0] ?? null

export function detectAts(url: string, html = ''): AtsInfo {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { type: 'custom', token: null, host: null }
  }
  const host = u.host.toLowerCase()
  if (host.includes('greenhouse.io')) {
    // boards.greenhouse.io/<t>, job-boards.greenhouse.io/<t>, boards.greenhouse.io/embed/job_board?for=<t>
    const forParam = u.searchParams.get('for')
    const seg = firstSeg(u)
    return { type: 'greenhouse', token: forParam || (seg !== 'embed' ? seg : null), host }
  }
  if (host.includes('lever.co')) return { type: 'lever', token: firstSeg(u), host }
  if (host.includes('ashbyhq.com')) return { type: 'ashby', token: firstSeg(u), host }
  if (host.includes('workable.com')) {
    const seg = firstSeg(u)
    return { type: 'workable', token: seg === 'j' ? null : seg, host }
  }
  if (host.includes('smartrecruiters.com')) return { type: 'smartrecruiters', token: firstSeg(u), host }
  if (host.includes('recruitee.com')) return { type: 'recruitee', token: host.split('.')[0], host }
  if (host.includes('myworkdayjobs.com') || host.includes('myworkdaysite.com')) {
    const wd = parseWorkday(url)
    return { type: 'workday', token: wd ? `${wd.tenant}/${wd.site}` : null, host }
  }
  if (host.includes('icims.com')) return { type: 'icims', token: host.split('.')[0], host }
  if (host.includes('taleo.net')) return { type: 'taleo', token: host.split('.')[0], host }
  if (host.includes('successfactors') || host.includes('sapsf')) return { type: 'successfactors', token: null, host }

  // Embedded boards on a company's own careers page.
  const h = html.slice(0, 400_000)
  let m = /boards(?:-api)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=|v1\/boards\/)?([a-z0-9_-]+)/i.exec(h)
  if (m && m[1] !== 'embed') return { type: 'greenhouse', token: m[1], host }
  m = /grnhse_app|greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9_-]+)/i.exec(h)
  if (m && m[1]) return { type: 'greenhouse', token: m[1], host }
  m = /jobs\.lever\.co\/([a-z0-9_-]+)/i.exec(h)
  if (m) return { type: 'lever', token: m[1], host }
  m = /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i.exec(h)
  if (m) return { type: 'ashby', token: m[1], host }
  m = /apply\.workable\.com\/([a-z0-9_-]+)/i.exec(h)
  if (m) return { type: 'workable', token: m[1], host }
  m = /([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/[A-Za-z0-9_-]+)/i.exec(h)
  if (m) {
    const wd = parseWorkday(`https://${m[1]}`)
    if (wd) return { type: 'workday', token: `${wd.tenant}/${wd.site}`, host: wd.host }
  }
  return { type: 'custom', token: null, host }
}

/** Where the application form lives for a posting URL on a known ATS. */
export function applyUrlFor(type: string, jobUrl: string): string {
  try {
    const u = new URL(jobUrl)
    if (type === 'lever' && !/\/apply\/?$/.test(u.pathname)) {
      u.pathname = `${u.pathname.replace(/\/+$/, '')}/apply`
      return u.toString()
    }
    if (type === 'ashby' && !/\/application\/?$/.test(u.pathname)) {
      u.pathname = `${u.pathname.replace(/\/+$/, '')}/application`
      return u.toString()
    }
  } catch {
    /* keep as is */
  }
  return jobUrl
}
