/**
 * Career-page scanning: big-employer search (Amazon, Microsoft/Eightfold,
 * Google), the stricter link reader for custom pages, and role fallback.
 * Pure functions only, no network.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

// The scanner module opens the database on import: never let that be your real one.
process.env.AUTO_APPLY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-scanner-'))
delete process.env.DATABASE_URL

const await_import_bigtech = await import('../lib/jobs/bigtech.ts')
const { detectBigTech, planSearch, parseGoogleResults } = await_import_bigtech
const { extractJobLinks, extractJsonLdListings } = await import('../lib/server/scanner.ts')
const { googleJobSections } = await import('../lib/jobs/jd.ts')
const { rolesFromTitles } = await import('../lib/jobs/context.ts')

describe('big employers', () => {
  test('any amazon.jobs page is treated as an Amazon search', () => {
    for (const u of [
      'https://www.amazon.jobs/content/en/career-programs/military',
      'https://www.amazon.jobs/en/',
      'https://amazon.jobs/en/search?base_query=sde',
    ]) {
      assert.deepEqual(detectBigTech(u), { type: 'amazon', token: null }, u)
    }
  })

  test('Microsoft, Eightfold-hosted and Google careers are detected', () => {
    assert.deepEqual(detectBigTech('https://jobs.careers.microsoft.com/global/en/search'), { type: 'eightfold', token: 'microsoft.com' })
    assert.deepEqual(detectBigTech('https://apply.careers.microsoft.com/careers?query=sde'), { type: 'eightfold', token: 'microsoft.com' })
    assert.deepEqual(detectBigTech('https://acme.eightfold.ai/careers?domain=acme.io'), { type: 'eightfold', token: 'acme.io' })
    assert.equal(detectBigTech('https://www.google.com/about/careers/applications/jobs/results')?.type, 'google')
    assert.equal(detectBigTech('https://careers.google.com/jobs/')?.type, 'google')
    assert.equal(detectBigTech('https://www.google.com/search?q=jobs'), null)
    assert.equal(detectBigTech('https://boards.greenhouse.io/acme'), null)
  })

  test('search plan: roles and country from your preferences', () => {
    const p = planSearch(['Software Engineer', ' Backend Engineer ', 'software engineer'], ['Bengaluru', 'Hyderabad', 'Remote'])
    assert.deepEqual(p.roles, ['Software Engineer', 'Backend Engineer'], 'trimmed, case-insensitive dedupe')
    assert.deepEqual(p.countries3, ['IND'])
    assert.deepEqual(p.countryNames, ['India'])
    const none = planSearch([], [], 'Chennai, Tamil Nadu')
    assert.deepEqual(none.roles, ['Software Engineer'], 'falls back to a sensible default')
    assert.deepEqual(none.countries3, ['IND'], 'falls back to your current location')
    assert.deepEqual(planSearch(['SDE'], ['London', 'Bangalore']).countries3, ['GBR', 'IND'])
  })

  test('Google results page: title, location, qualifications, link', () => {
    const card = (id: string, title: string, loc: string) =>
      `<li><h3 class="QJPWVe">${title}</h3><div class="EAcu5e Gx4ovb"><p class="l103df">Google | <span class="pwO9Dc"><span class="r0wTof ">${loc}</span></span></p></div>` +
      `<div class="Xsxa1e"><h4>Minimum qualifications</h4><ul><li>Bachelor’s degree.</li><li>1 year of experience with Java.</li></ul></div>` +
      `<a class="WpHeLc" href="jobs/results/${id}-${title.toLowerCase().replace(/\W+/g, '-')}?q=software" aria-label="Learn more about ${title}" jsname="x"></a></li>`
    const html = `<ul>${card('123456789', 'Software Engineer, Cloud', 'Bengaluru, Karnataka, India')}${card('223456789', 'Software Engineer III, Ads &amp; Search', 'YouTube | Hyderabad, Telangana, India')}</ul>`
    const jobs = parseGoogleResults(html, 'https://www.google.com/about/careers/applications/jobs/results?q=software')
    assert.equal(jobs.length, 2)
    assert.equal(jobs[0].title, 'Software Engineer, Cloud')
    assert.equal(jobs[0].location, 'Bengaluru, Karnataka, India')
    assert.equal(jobs[0].ats_job_id, '123456789')
    assert.match(jobs[0].url, /^https:\/\/www\.google\.com\/about\/careers\/applications\/jobs\/results\/123456789-/)
    assert.match(jobs[0].description_html ?? '', /1 year of experience with Java/)
    assert.equal(jobs[1].title, 'Software Engineer III, Ads & Search')
    assert.equal(jobs[1].location, 'Hyderabad, Telangana, India', 'brand prefixes dropped')
  })

  test('Google job page: qualifications through responsibilities', () => {
    const page = '<nav>menu</nav><h3>Minimum qualifications:</h3><ul><li>BS</li></ul><h3>About the job</h3><p>Build things.</p><h3>Responsibilities</h3><ul><li>Code</li></ul><footer>x</footer>'
    const s = googleJobSections(page)!
    assert.match(s, /Minimum qualifications/)
    assert.match(s, /Code<\/li><\/ul>$/)
    assert.doesNotMatch(s, /menu|footer/)
    assert.equal(googleJobSections('<p>nothing</p>'), null)
  })
})

describe('Amazon search URLs (network stubbed)', () => {
  const { searchAmazon } = await_import_bigtech
  async function capture(url: string, roles: string[]): Promise<URLSearchParams[]> {
    const seen: URLSearchParams[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (u: string | URL) => {
      seen.push(new URL(String(u)).searchParams)
      return new Response(JSON.stringify({ hits: 1, jobs: [{ title: 'SDE', job_path: '/en/jobs/1/sde', normalized_location: 'Bengaluru, IND', posted_date: 'November 6, 2026', id_icims: '1' }] }), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      await searchAmazon(url, planSearch(roles, ['Bengaluru']))
    } finally {
      globalThis.fetch = real
    }
    return seen
  }

  test('an empty search box is filled with your roles; pasted filters are kept', async () => {
    const q = await capture('https://www.amazon.jobs/en/search?base_query=&loc_query=India&country=IND', ['Software Engineer', 'Backend Engineer'])
    assert.deepEqual(q.map((p) => p.get('base_query')), ['Software Engineer', 'Backend Engineer'], 'never an empty "everything" search')
    assert.ok(q.every((p) => p.get('country') === 'IND' && p.get('loc_query') === 'India'))
  })

  test('a pasted search with keywords is used as-is', async () => {
    const q = await capture('https://www.amazon.jobs/en/search?base_query=sde+intern&country=USA', ['Software Engineer'])
    assert.equal(q.length, 1)
    assert.equal(q[0].get('base_query'), 'sde intern')
    assert.equal(q[0].get('country'), 'USA')
  })

  test('a plain careers page searches your roles in your country', async () => {
    const q = await capture('https://www.amazon.jobs/content/en/career-programs/military', ['Software Engineer'])
    assert.equal(q[0].get('base_query'), 'Software Engineer')
    assert.equal(q[0].get('country'), 'IND')
  })
})

describe('custom careers pages', () => {
  const BASE = 'https://careers.example.com/'

  test('section links ("Military careers", "Job Categories") are not jobs', () => {
    const html = `
      <nav>
        <a href="/content/en/career-programs/military">Military careers</a>
        <a href="/content/en/job-categories">Job Categories</a>
        <a href="/content/en/our-workplace/teams">Teams</a>
        <a href="/en/students">Students &amp; graduates</a>
        <a href="/life-at-example">Life at Example</a>
        <a href="/careers/benefits">Benefits</a>
        <a href="/jobs">See all jobs</a>
        <a href="/">Careers</a>
      </nav>
      <main>
        <a href="/en/jobs/2871234/software-development-engineer-ii">Software Development Engineer II</a>
        <a href="/en/jobs/2871299/data-analyst">Data Analyst, Payments</a>
        <a href="/positions/backend-platform-engineer-bengaluru">Backend Platform Engineer</a>
        <a href="https://boards.greenhouse.io/example/jobs/4455667">Site Reliability Engineer</a>
      </main>`
    const jobs = extractJobLinks(html, BASE)
    assert.deepEqual(
      jobs.map((j) => j.title),
      ['Software Development Engineer II', 'Data Analyst, Payments', 'Backend Platform Engineer', 'Site Reliability Engineer'],
    )
  })

  test('a posting URL counts even without a role word in the text', () => {
    const jobs = extractJobLinks('<a href="/jobs/98765/frontend">Frontend (React)</a><a href="/teams/frontend">Frontend team</a>', BASE)
    assert.deepEqual(jobs.map((j) => j.url), ['https://careers.example.com/jobs/98765/frontend'])
  })

  test('JobPosting JSON-LD on a listing page is used when present', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
      {"@type":"ListItem","item":{"@type":"JobPosting","title":"Java Developer","url":"/jobs/1-java","datePosted":"2026-11-01",
       "jobLocation":{"@type":"Place","address":{"addressLocality":"Chennai","addressCountry":"IN"}},"description":"<p>Spring</p>"}}]}</script>`
    const jobs = extractJsonLdListings(html, BASE)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].title, 'Java Developer')
    assert.equal(jobs[0].url, 'https://careers.example.com/jobs/1-java')
    assert.equal(jobs[0].location, 'Chennai, IN')
    assert.equal(jobs[0].posted_at?.slice(0, 10), '2026-11-01')
  })
})

describe('roles from your resume', () => {
  test('job titles become search roles when no target roles are set', () => {
    assert.deepEqual(
      rolesFromTitles(['Software Engineer Intern', 'Software Engineer - Payments', 'Research Assistant (Part-time)', '\\textbf{Data Analyst}', 'Software Engineer']),
      ['Software Engineer', 'Research Assistant', 'Data Analyst'],
    )
  })
})
