import { nameFromHost, normalizeCareerUrl } from '@/lib/companies/url'
import { detectAts } from '@/lib/jobs/ats'
import { httpGet } from '@/lib/jobs/fetch'
import { decodeEntities, extractJsonLdJob } from '@/lib/jobs/html'
import { rescoreJobs } from '@/lib/jobs/store'
import * as db from '@/lib/server/db'
import { HttpError, handler, json, readJson } from '@/lib/server/http'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

/** Title from the page itself: JobPosting data, then og:title, then <title> without the site suffix. */
function titleFrom(html: string, url: URL): string {
  const ld = extractJsonLdJob(html)
  if (ld?.title) return ld.title
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1]
  const t = og || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ''
  const clean = decodeEntities(t).replace(/\s+/g, ' ').split(/\s[|–—-]\s/)[0].trim()
  if (clean) return clean
  const slug = url.pathname.split('/').filter(Boolean).pop() || 'Job'
  return decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\d{4,}/g, '').trim() || 'Job'
}

/**
 * "Add a job by link": a posting you found elsewhere (a friend, LinkedIn, a
 * company page) joins your jobs list so you can score it and apply through
 * the same flow. Its company is reused when known, otherwise created paused
 * (a single job link isn't a careers page to scan).
 */
export const POST = handler(async (req: Request) => {
  const { url: raw } = await readJson<{ url?: string }>(req)
  const url = normalizeCareerUrl(raw || '')
  const existing = await db.findCompanyJobByUrl(url)
  if (existing) return json({ job_id: existing.id, existing: true })

  const u = new URL(url)
  let html = ''
  try {
    const r = await httpGet(url, { signal: AbortSignal.timeout(20_000) })
    if (r.ok) html = (await r.text()).slice(0, 2_000_000)
  } catch {
    /* the title falls back to the link; the description is fetched in the background */
  }
  const ld = html ? extractJsonLdJob(html) : null
  const title = html ? titleFrom(html, u) : titleFrom('', u)

  // Same host as a watched company → that company; else a new, paused one.
  const companies = await db.listCompanies()
  const host = u.hostname.replace(/^www\./, '')
  let company = companies.find((c) => {
    try {
      return new URL(c.career_url).hostname.replace(/^www\./, '') === host
    } catch {
      return false
    }
  })
  if (!company) {
    const origin = `${u.protocol}//${u.host}`
    const created = companies.find((c) => c.career_url === origin) ?? (await db.addCompany(nameFromHost(u.hostname), origin))
    if (!created) throw new HttpError(500, 'Couldn’t create the company for that link.')
    const ats = detectAts(url, html)
    await db.updateCompany(created.id, { paused: 1, ats_type: ats.type, ats_token: ats.token })
    company = created
  }
  const id = await db.insertCompanyJob({ companyId: company.id, url, title, location: ld?.location ?? null, postedAt: ld?.datePosted ?? null })
  await enqueue('jobs.fetch_jd', { job_id: id }, { dedupeKey: `jd:${id}` })
  await rescoreJobs([id])
  return json({ job_id: id, existing: false })
})
