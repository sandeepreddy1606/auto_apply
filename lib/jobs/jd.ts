/**
 * Per-job description fetch, for boards whose list API doesn't include it
 * (SmartRecruiters, Workday, custom pages) and for refreshing a stale JD.
 */
import { parseWorkday } from './ats'
import { eightfoldDetails } from './bigtech'
import { asArray, getJson, getText, prop, str, toIso } from './fetch'
import { extractJsonLdJob, extractMainContent, htmlToText, sanitizeHtml } from './html'
import { jobRowForFetch, saveJobDescription } from './store'

export interface FetchedJd {
  html: string
  text: string
  posted_at: string | null
}

export async function fetchJdFor(job: {
  url: string
  ats_type: string | null
  ats_token: string | null
  ats_job_id: string | null
}): Promise<FetchedJd> {
  const type = job.ats_type || 'custom'
  if (type === 'eightfold' && job.ats_job_id) {
    const d = await eightfoldDetails(job.url, job.ats_job_id, job.ats_token || 'microsoft.com')
    const clean = sanitizeHtml(d.html)
    if (htmlToText(clean).length > 80) return { html: clean, text: htmlToText(clean), posted_at: d.posted_at }
  }
  if (type === 'google') {
    const page = await getText(job.url)
    const html = googleJobSections(page)
    if (html) {
      const clean = sanitizeHtml(html)
      return { html: clean, text: htmlToText(clean), posted_at: null }
    }
  }
  if (type === 'smartrecruiters' && job.ats_token && job.ats_job_id) {
    const data = await getJson(
      `https://api.smartrecruiters.com/v1/companies/${job.ats_token}/postings/${job.ats_job_id}`,
    )
    const sections = prop(prop(data, 'jobAd'), 'sections')
    const html = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map((k) => {
        const s = prop(sections, k)
        const title = str(prop(s, 'title'))
        const body = str(prop(s, 'text'))
        return body ? `<h3>${title}</h3>${body}` : ''
      })
      .join('')
    const clean = sanitizeHtml(html)
    return { html: clean, text: htmlToText(clean), posted_at: toIso(prop(data, 'releasedDate')) }
  }
  if (type === 'workday') {
    const wd = parseWorkday(job.url)
    const path = job.ats_job_id || (() => {
      try {
        const p = new URL(job.url).pathname
        const i = p.indexOf('/job/')
        return i >= 0 ? p.slice(i) : null
      } catch {
        return null
      }
    })()
    if (wd && path) {
      const data = await getJson(`https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}${path}`)
      const info = prop(data, 'jobPostingInfo')
      const clean = sanitizeHtml(str(prop(info, 'jobDescription')))
      return { html: clean, text: htmlToText(clean), posted_at: toIso(prop(info, 'startDate')) }
    }
  }
  if (type === 'greenhouse' && job.ats_token && job.ats_job_id) {
    const data = await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${job.ats_token}/jobs/${job.ats_job_id}`,
    )
    const clean = sanitizeHtml(str(prop(data, 'content')))
    return { html: clean, text: htmlToText(clean), posted_at: toIso(prop(data, 'updated_at')) }
  }
  if (type === 'lever' && job.ats_token && job.ats_job_id) {
    const data = await getJson(`https://api.lever.co/v0/postings/${job.ats_token}/${job.ats_job_id}`)
    const lists = asArray(prop(data, 'lists'))
      .map((l) => `<h3>${str(prop(l, 'text'))}</h3><ul>${str(prop(l, 'content'))}</ul>`)
      .join('')
    const clean = sanitizeHtml(`${str(prop(data, 'description'))}${lists}${str(prop(data, 'additional'))}`)
    return { html: clean, text: htmlToText(clean), posted_at: toIso(prop(data, 'createdAt')) }
  }

  // Generic page: JSON-LD JobPosting first, then main-content extraction.
  const page = await getText(job.url)
  const ld = extractJsonLdJob(page)
  if (ld?.description && htmlToText(ld.description).length > 80) {
    const clean = sanitizeHtml(ld.description)
    return { html: clean, text: htmlToText(clean), posted_at: toIso(ld.datePosted) }
  }
  const main = extractMainContent(page)
  if (main.text.length >= 300) return { html: main.html, text: main.text, posted_at: null }

  // JavaScript-rendered page: render it in the automation browser if available.
  const rendered = await renderWithBrowser(job.url)
  if (rendered) {
    const m = extractMainContent(rendered)
    if (m.text.length >= 200) return { html: m.html, text: m.text, posted_at: null }
  }
  throw new Error('No readable job description on the page (it may need sign-in or JavaScript).')
}

/**
 * Google job page: "Minimum qualifications" through the end of the
 * "Responsibilities" list (the page around it is navigation and scripts).
 */
export function googleJobSections(page: string): string | null {
  const start = page.search(/<h3>Minimum qualifications:?<\/h3>/)
  if (start < 0) return null
  const resp = page.indexOf('<h3>Responsibilities', start)
  const end = resp >= 0 ? page.indexOf('</ul>', resp) : -1
  const stop = end >= 0 ? end + 5 : Math.min(page.length, start + 20_000)
  return page.slice(start, stop)
}

async function renderWithBrowser(url: string): Promise<string | null> {
  try {
    const { renderPage } = await import('@/lib/apply/browser')
    return await renderPage(url)
  } catch {
    return null
  }
}

/** Task handler body: fetch + store one job's description. */
export async function fetchAndStoreJd(jobId: number): Promise<{ chars: number }> {
  const job = await jobRowForFetch(jobId)
  if (!job) throw new Error(`Job ${jobId} not found`)
  try {
    const jd = await fetchJdFor(job)
    await saveJobDescription(jobId, {
      description_html: jd.html,
      description_text: jd.text.slice(0, 60_000),
      posted_at: jd.posted_at,
      error: null,
    })
    return { chars: jd.text.length }
  } catch (e) {
    await saveJobDescription(jobId, {
      description_html: null,
      description_text: null,
      error: (e as Error).message.slice(0, 300),
    })
    throw e
  }
}
