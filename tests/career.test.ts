/**
 * Unit tests for the career-page apply flow's pure logic: JD analysis and
 * scoring, ATS detection, HTML handling, the LaTeX parser (lossless round
 * trip on a real resume), fact bank, tailoring guards, plan application,
 * the base-resume linter, and the form-answer resolver.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

import { analyzeJd, detectSeniority, parseExperience, splitSections } from '../lib/jobs/analyze.ts'
import { applyUrlFor, detectAts, parseWorkday } from '../lib/jobs/ats.ts'
import { relativePostedToIso } from '../lib/jobs/fetch.ts'
import { decodeEntities, extractJsonLdJob, htmlToText, sanitizeHtml } from '../lib/jobs/html.ts'
import { degreeLevelOf, explain, freshnessScore, locationScore, scoreJob, titleDegree, titleScore } from '../lib/jobs/score.ts'
import { canonicalSkills, extractSkills } from '../lib/jobs/skills.ts'
import { experienceYearsFromFacts } from '../lib/jobs/context.ts'
import { buildFacts, extractMetrics } from '../lib/resume/facts.ts'
import { parseResume, renderResume } from '../lib/resume/latex/parse.ts'
import { escapeLatex, latexToPlain, readArgs } from '../lib/resume/latex/util.ts'
import { hasBlockingIssues, lintBase, resolveIssue } from '../lib/resume/lint.ts'
import { applyPlan, drift, guardPlan, identityPlan, validatePlan } from '../lib/resume/plan.ts'
import type { TailorPlan } from '../lib/resume/plan.ts'
import { ATTESTATION_RE, matchOption, normQuestion, planReady, resolveField, tokenSetRatio } from '../lib/apply/resolve.ts'
import type { ResolveContext } from '../lib/apply/resolve.ts'
import type { ApplyAnswers, FormField, JobPrefs } from '../lib/types.ts'

const BASE = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/resume/base.tex'), 'utf-8')

const PREFS: JobPrefs = {
  target_roles: ['Software Engineer', 'Backend Engineer'],
  seniority: ['intern', 'new_grad', 'junior'],
  experience_years_override: '',
  locations: ['Chennai', 'Bengaluru'],
  remote_ok: true,
  open_to_relocation: true,
  include_keywords: [],
  exclude_keywords: ['Senior', 'Staff', 'Principal', 'Lead', 'Manager'],
  excluded_companies: [],
  threshold: 55,
  freshness_days: 45,
  require_title_match: true,
  max_experience_gap: 2,
}

// ---------------------------------------------------------------- skills / JD

describe('skills dictionary', () => {
  test('finds canonical skills via aliases and symbols', () => {
    const s = extractSkills('We use k8s, Node.js, C#, .NET Core, REST APIs and Postgres on AWS.')
    for (const k of ['Kubernetes', 'Node.js', 'C#', '.NET', 'REST APIs', 'PostgreSQL', 'AWS']) assert.ok(s.includes(k), k)
  })
  test('broader dictionary: data, ML, mobile, testing tools', () => {
    const s = extractSkills('3+ years with Redshift, Tableau and QuickSight; Snowflake data warehouse; Selenium and Cypress; Flutter apps; LangChain RAG with Pinecone; SVM and K-Means models.')
    for (const k of ['Redshift', 'Tableau', 'QuickSight', 'Data Warehousing', 'Selenium', 'Cypress', 'LangChain', 'Vector Databases', 'Machine Learning']) assert.ok(s.includes(k), k)
  })
  test('a skill’s own name must not match plain English', () => {
    assert.ok(!extractSkills('Facilities agents depend on our tools every day.').includes('AI Agents'))
    assert.ok(!extractSkills('You will excel at networking with stakeholders.').includes('Excel'))
  })
  test('ambiguous words need technical context', () => {
    assert.ok(!extractSkills('Let us go to the meeting and rest.').includes('Go'))
    assert.ok(extractSkills('Backend services in Go and Python').includes('Go'))
  })
  test('canonicalises user skill lists', () => {
    const c = canonicalSkills(['javascript, k8s', 'working knowledge of C# and .NET'])
    assert.ok(c.has('JavaScript') && c.has('Kubernetes') && c.has('C#') && c.has('.NET'))
  })
})

describe('JD analysis', () => {
  const jd = `About the role\nBuild APIs.\nRequirements\n- 1-3 years of experience with Java and Spring Boot\n- SQL, Docker\nNice to have\n- Kafka, Kubernetes\nExperience with GraphQL is a plus.`
  test('splits required vs preferred', () => {
    const { required, preferred } = splitSections(jd)
    assert.match(required, /Spring Boot/)
    assert.match(preferred, /Kafka/)
    assert.match(preferred, /GraphQL/)
  })
  test('extracts skills by section', () => {
    const a = analyzeJd('Software Engineer I', jd)
    assert.ok(a.required.includes('Java') && a.required.includes('Spring Boot') && a.required.includes('Docker'))
    assert.ok(a.preferred.includes('Kafka') && a.preferred.includes('Kubernetes') && a.preferred.includes('GraphQL'))
    assert.ok(!a.preferred.includes('Java'))
    assert.deepEqual(a.experience && [a.experience.min, a.experience.max], [1, 3])
  })
  test('one-paragraph JD splits at the "nice to have" marker', () => {
    const a = analyzeJd('Backend Engineer', 'Requirements 0-2 years of experience with Java, Spring Boot, Docker, SQL and REST APIs. Build payment services. Nice to have Kafka, Kubernetes, AWS.')
    assert.ok(a.required.includes('Java') && a.required.includes('Docker'))
    assert.ok(a.preferred.includes('Kafka') && a.preferred.includes('AWS'))
    assert.ok(!a.preferred.includes('Java'))
  })
  test('experience phrasing', () => {
    const e = parseExperience('3+ years of professional experience')!
    assert.equal(e.min, 3)
    assert.equal(e.max, null)
    assert.match(e.text, /^3\+ years of professional experience/)
    assert.equal(parseExperience('at least five years experience')?.min, 5)
    assert.deepEqual(parseExperience('Open to new grads and freshers'), { min: 0, max: 1, text: 'entry level' })
    assert.equal(parseExperience('no requirement listed'), null)
  })
  test('experience as real postings write it', () => {
    const amazon = 'Basic qualifications\n- 3+ years of non-internship professional software development experience\n- 2+ years of non-internship design or architecture experience\nPreferred qualifications\n- 5+ years of full software development life cycle'
    assert.equal(parseExperience(amazon)?.min, 3, 'the first basic qualification, not a later one or the preferred one')
    assert.equal(analyzeJd('SDE II', amazon).experience_preferred?.min, 5)
    const google = 'Minimum qualifications:\nBachelor’s degree or equivalent practical experience.\n2 years of experience with software development in one or more programming languages, or 1 year of experience with an advanced degree.'
    assert.equal(parseExperience(google)?.min, 2)
    assert.equal(parseExperience('- 2+ years of Tableau Desktop, Quicksight or other BI tools')?.min, 2, 'no word "experience" needed after a "+"')
    assert.deepEqual([parseExperience('Experience: 2 to 4 years')?.min, parseExperience('Experience: 2 to 4 years')?.max], [2, 4])
    assert.equal(parseExperience('Minimum of two years’ experience in Java')?.min, 2)
    assert.equal(parseExperience('6+ months of internship experience')?.min, 0.5)
    assert.equal(parseExperience('3 years or more in backend development')?.min, 3)
    // Not experience requirements.
    for (const noise of [
      'Own a multi-year product vision and roadmap.',
      'We distribute millions of products each year.',
      'Applicants must be 18 years old.',
      'A 4-year degree in Computer Science.',
      'Our company has 20 years of history in retail.',
      'Customers for years to come.',
    ]) assert.equal(parseExperience(noise), null, noise)
  })
  test('education, job type, work mode, pay, visa', () => {
    const d = analyzeJd('Software Engineer', "Bachelor's or Master's degree in Computer Science or a related field, or equivalent experience. This is a hybrid role (3 days in office). Compensation: ₹18 - 24 LPA. We are unable to sponsor visas for this position. Immediate joiners preferred.").details
    assert.equal(d.education?.level, 'bachelors')
    assert.ok(d.education?.fields.includes('Computer Science'))
    assert.equal(d.education?.equivalent, true)
    assert.equal(d.work_mode, 'hybrid')
    assert.match(d.salary ?? '', /18 - 24 LPA/i)
    assert.equal(d.visa, 'no-sponsorship')
    assert.match(d.notice ?? '', /immediate joiners/i)
    // "non-internship experience" doesn't make an SDE role an internship; the title decides.
    assert.equal(analyzeJd('Software Development Engineer II', '3+ years of non-internship professional experience').details.employment_type, null)
    assert.equal(analyzeJd('ML Data Associate (Fixed Term Contract)', '2+ years of previous internship').details.employment_type, 'contract')
    assert.equal(analyzeJd('Software Engineering Intern', 'Summer 2027').details.employment_type, 'internship')
    assert.equal(analyzeJd('Backend Engineer', 'This position is fully remote within India.').details.work_mode, 'remote')
  })
  test('seniority from title', () => {
    assert.equal(detectSeniority('Software Engineering Intern'), 'intern')
    assert.equal(detectSeniority('Senior Backend Engineer'), 'senior')
    assert.equal(detectSeniority('SDE-1'), 'junior')
    assert.equal(detectSeniority('New Grad Software Engineer'), 'new_grad')
    assert.equal(detectSeniority('Software Engineer'), null)
  })
})

describe('scoring', () => {
  const ctx = { prefs: PREFS, skills: canonicalSkills(['Java', 'Spring Boot', 'Docker', 'SQL', 'Python']), years: 0.7, fallbackRoles: [] }
  const job = (title: string, extra: Partial<Parameters<typeof scoreJob>[0]> = {}) => ({
    title,
    location: 'Bengaluru, India',
    description_text: 'Requirements\n0-2 years. Java, Spring Boot, Docker, SQL.\nNice to have\nKafka',
    posted_at: new Date().toISOString(),
    first_seen_at: null,
    company_id: 1,
    company_priority: 'normal',
    ...extra,
  })
  test('a well-matched junior backend role scores high', () => {
    const { score, breakdown } = scoreJob(job('Backend Engineer I'), ctx)
    assert.ok(score >= 80, `score ${score}`)
    assert.equal(breakdown.excluded, null)
    assert.deepEqual(breakdown.skills_missing, ['Kafka'])
  })
  test('a title that asks for a higher degree than yours is filtered, with the reason', () => {
    const mine = { ...ctx, degree: degreeLevelOf('Bachelor of Technology, Computer Science and Engineering') }
    assert.equal(mine.degree, 'bachelors')
    const phd = scoreJob(job('Software Engineer, AI/ML, PhD, Early Career, 2026'), mine)
    assert.equal(phd.score, 0)
    assert.match(phd.breakdown.excluded ?? '', /PhD.*bachelor/)
    // Same job for someone with a PhD, and a plain title for you: not filtered.
    assert.equal(scoreJob(job('Software Engineer, AI/ML, PhD, Early Career, 2026'), { ...ctx, degree: 'phd' }).breakdown.excluded, null)
    assert.equal(scoreJob(job('Backend Engineer I'), mine).breakdown.excluded, null)
    // Unknown degree: never filtered on a guess.
    assert.equal(scoreJob(job('Software Engineer, PhD'), ctx).breakdown.excluded, null)
  })
  test('a description whose minimum degree is above yours scores lower; "or equivalent" does not', () => {
    const mine = { ...ctx, degree: 'bachelors' as const }
    const base = scoreJob(job('Backend Engineer I'), mine).score
    const masters = scoreJob(job('Backend Engineer I', { description_text: "Requirements\nA Master's in Computer Science is required. 0-2 years. Java, Spring Boot, Docker, SQL." }), mine).score
    const equiv = scoreJob(job('Backend Engineer I', { description_text: "Requirements\nA Master's in Computer Science or equivalent experience. 0-2 years. Java, Spring Boot, Docker, SQL." }), mine).score
    assert.ok(masters < base, `${masters} < ${base}`)
    assert.ok(equiv > masters, `${equiv} > ${masters}`)
  })
  test('degree names', () => {
    assert.equal(degreeLevelOf('B.Tech in CSE'), 'bachelors')
    assert.equal(degreeLevelOf('M.Tech, Data Science'), 'masters')
    assert.equal(degreeLevelOf('MBA'), 'masters')
    assert.equal(degreeLevelOf('PhD, Machine Learning'), 'phd')
    assert.equal(degreeLevelOf(''), null)
    assert.equal(titleDegree('Research Scientist Intern, PhD'), 'phd')
    assert.equal(titleDegree('Software Engineer, Early Career'), null)
  })
  test('excluded keyword forces 0 with a reason', () => {
    const { score, breakdown } = scoreJob(job('Senior Software Engineer'), ctx)
    assert.equal(score, 0)
    assert.match(breakdown.excluded ?? '', /Senior/)
  })
  test('seniority outside your levels is filtered', () => {
    const { score, breakdown } = scoreJob(job('Software Engineer II'), { ...ctx, prefs: { ...PREFS, exclude_keywords: [] } })
    assert.equal(score, 0)
    assert.match(breakdown.excluded ?? '', /seniority/)
  })
  test('unrelated title scores below threshold', () => {
    const { score } = scoreJob(job('Account Executive', { description_text: 'Sell software to enterprises.' }), ctx)
    assert.ok(score < PREFS.threshold, `score ${score}`)
  })
  test('a title matching none of your roles is filtered, even with matching skills', () => {
    // Real cases from a live scan: these scored 58–72 on skills + location alone.
    for (const t of ['Graphic Designer, IN-Events', 'Transportation Representative', 'Full Life Cycle Recruiter, AWS']) {
      const { score, breakdown } = scoreJob(job(t), ctx)
      assert.equal(score, 0, t)
      assert.match(breakdown.excluded ?? '', /title doesn.t match your roles/, t)
    }
    // Synonyms still pass the gate.
    assert.equal(scoreJob(job('Software Development Engineer, Payments'), ctx).breakdown.excluded, null)
    // A shared topic word alone ("software") is not a role match.
    assert.match(scoreJob(job('Associate, Quality Services, Auto Software (Smart Vehicles)'), ctx).breakdown.excluded ?? '', /title doesn.t match/)
    // An explicit level beats "Associate" in a team name.
    assert.match(scoreJob(job('Software Development Engineer III, Associate Experience'), ctx).breakdown.excluded ?? '', /seniority: mid/)
    assert.equal(scoreJob(job('Associate Software Engineer'), ctx).breakdown.excluded, null)
    // The gate can be switched off, and doesn't apply to roles guessed from your resume.
    assert.notEqual(scoreJob(job('Graphic Designer'), { ...ctx, prefs: { ...PREFS, require_title_match: false } }).score, 0)
    assert.notEqual(scoreJob(job('Graphic Designer'), { ...ctx, prefs: { ...PREFS, target_roles: [] }, fallbackRoles: ['Software Engineer'] }).breakdown.excluded?.includes('title'), true)
  })
  test('a job asking for far more experience than you have is filtered', () => {
    const six = job('Software Engineer', { description_text: 'Requirements\n6+ years of experience with Java and SQL.' })
    const r = scoreJob(six, ctx)
    assert.equal(r.score, 0)
    assert.match(r.breakdown.excluded ?? '', /asks for 6\+ years \(you have about 8 months\)/)
    // Within the allowed gap (0.7 y vs 2 y asked, gap 2) it stays.
    const two = job('Software Engineer', { description_text: 'Requirements\n2+ years of experience with Java and SQL.' })
    assert.equal(scoreJob(two, ctx).breakdown.excluded, null)
    // Gap 10 = off; unknown experience never filters.
    assert.equal(scoreJob(six, { ...ctx, prefs: { ...PREFS, max_experience_gap: 10 } }).breakdown.excluded, null)
    assert.equal(scoreJob(six, { ...ctx, years: null }).breakdown.excluded, null)
  })
  test('title synonyms', () => {
    assert.equal(titleScore('SDE', ['Software Engineer'])[0], 1)
    assert.equal(titleScore('Software Development Engineer - Payments', ['Software Engineer'])[0], 1)
    assert.ok(titleScore('Data Analyst', ['Software Engineer'])[0] < 0.5)
  })
  test('location and freshness', () => {
    assert.equal(locationScore('Remote - India', PREFS), 1)
    assert.equal(locationScore('Chennai', PREFS), 1)
    assert.equal(locationScore('London', { ...PREFS, open_to_relocation: false }), 0)
    const now = new Date('2026-11-08T00:00:00Z')
    assert.equal(freshnessScore('2026-11-07T00:00:00Z', 45, now), 1)
    assert.equal(freshnessScore('2026-08-01T00:00:00Z', 45, now), 0)
  })
  test('explain is human readable', () => {
    const r = scoreJob(job('Backend Engineer I'), ctx)
    assert.match(explain(r.score, r.breakdown, 'Bengaluru, India'), /title ✓ · \d+\/\d+ skills/)
  })
  test('experience years from resume dates (overlaps not double counted)', () => {
    const y = experienceYearsFromFacts(['Apr 2026 -- Present', 'Mar 2026 -- Apr 2026', 'May -- June 2025'], new Date(2026, 10, 15))
    assert.ok(y !== null && y > 0.8 && y < 1.2, String(y))
  })
})

describe('ATS detection', () => {
  test('known boards', () => {
    assert.deepEqual(detectAts('https://boards.greenhouse.io/stripe').type, 'greenhouse')
    assert.equal(detectAts('https://job-boards.greenhouse.io/stripe/jobs/123').token, 'stripe')
    assert.equal(detectAts('https://jobs.lever.co/netflix/abc').token, 'netflix')
    assert.equal(detectAts('https://jobs.ashbyhq.com/openai').type, 'ashby')
    assert.equal(detectAts('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite').token, 'nvidia/NVIDIAExternalCareerSite')
  })
  test('embedded boards on custom pages', () => {
    const html = '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>'
    assert.deepEqual(detectAts('https://acme.com/careers', html), { type: 'greenhouse', token: 'acme', host: 'acme.com' })
    assert.equal(detectAts('https://x.com/jobs', '<iframe src="https://jobs.lever.co/xco">').token, 'xco')
  })
  test('workday url parsing with locale', () => {
    assert.deepEqual(parseWorkday('https://acme.wd1.myworkdayjobs.com/en-US/External/job/Bangalore/SWE_R1'), { host: 'acme.wd1.myworkdayjobs.com', tenant: 'acme', site: 'External' })
    assert.equal(parseWorkday('https://example.com/jobs'), null)
  })
  test('apply url per board', () => {
    assert.equal(applyUrlFor('lever', 'https://jobs.lever.co/a/123'), 'https://jobs.lever.co/a/123/apply')
    assert.equal(applyUrlFor('ashby', 'https://jobs.ashbyhq.com/a/123'), 'https://jobs.ashbyhq.com/a/123/application')
  })
  test('workday relative dates', () => {
    const now = new Date('2026-11-08T00:00:00Z')
    assert.equal(relativePostedToIso('Posted Today', now), now.toISOString())
    assert.equal(relativePostedToIso('Posted 30+ Days Ago', now)?.slice(0, 10), '2026-10-09')
  })
})

describe('HTML handling', () => {
  test('sanitizer keeps formatting, drops scripts, attributes and unsafe links', () => {
    const out = sanitizeHtml('<p onclick="x()">Hi <b>there</b></p><script>alert(1)</script><a href="javascript:x">bad</a><a href="https://a.com">ok</a><img src=x>')
    assert.equal(out, '<p>Hi <b>there</b></p>bad<a href="https://a.com" target="_blank" rel="noopener noreferrer nofollow">ok</a>')
  })
  test('entity-escaped HTML (Greenhouse) is decoded first', () => {
    assert.equal(sanitizeHtml('&lt;p&gt;Java &amp;amp; Go&lt;/p&gt;'), '<p>Java &amp; Go</p>')
  })
  test('text extraction keeps list structure', () => {
    assert.equal(htmlToText('<h3>Req</h3><ul><li>Java</li><li>SQL</li></ul>'), 'Req\n\n• Java\n\n• SQL')
    assert.equal(decodeEntities('A&#39;s &mdash; &#x2713;'), 'A\'s — ✓')
  })
  test('JSON-LD JobPosting', () => {
    const j = extractJsonLdJob('<script type="application/ld+json">{"@type":"JobPosting","title":"SWE","description":"<p>Build</p>","datePosted":"2026-11-01"}</script>')
    assert.equal(j?.title, 'SWE')
    assert.equal(j?.datePosted, '2026-11-01')
  })
  test('JSON-LD with raw newlines inside strings (common on real sites) still parses', () => {
    const j = extractJsonLdJob('<script type="application/ld+json">{"@type":"JobPosting","title":"SWE","description":"Line one\nLine two\twith tab"}</script>')
    assert.equal(j?.description, 'Line one Line two with tab')
  })
})

// ---------------------------------------------------------------- LaTeX

describe('LaTeX utilities', () => {
  test('escape makes AI text inert', () => {
    assert.equal(escapeLatex('50% of C# & .NET {x} $5 #1 a_b ~ ^ \\cmd'), '50\\% of C\\# \\& .NET \\{x\\} \\$5 \\#1 a\\_b \\textasciitilde{} \\textasciicircum{} \\textbackslash{}cmd')
    assert.equal(escapeLatex('2–4 years — “quoted”'), "2--4 years --- ``quoted''")
  })
  test('plain text conversion', () => {
    assert.equal(latexToPlain('\\textbf{Top 5\\%}{ --- AUDEVDAY}'), 'Top 5% — AUDEVDAY')
    assert.equal(latexToPlain('Dev \\href{https://x}{\\textcolor{blue}{}} Intern'), 'Dev Intern')
    assert.equal(latexToPlain('A $\\vert$ B'), 'A | B')
  })
  test('brace-balanced args', () => {
    const r = readArgs('{a{b}}{c\\}}  {d}', 0, 3)
    assert.deepEqual(r?.args, ['a{b}', 'c\\}', 'd'])
  })
})

describe('resume parser', () => {
  const doc = parseResume(BASE)
  test('lossless round trip on the real resume', () => {
    assert.equal(renderResume(doc), BASE)
  })
  test('sections are classified', () => {
    assert.deepEqual(
      doc.sections.map((s) => s.kind),
      ['summary', 'skills', 'education', 'experience', 'projects', 'certifications', 'achievements'],
    )
  })
  test('entries and bullets', () => {
    const exp = doc.sections.find((s) => s.kind === 'experience')!
    assert.equal(exp.entries?.length, 3)
    assert.deepEqual(exp.entries!.map((e) => e.bullets.length), [5, 3, 4])
    const prj = doc.sections.find((s) => s.kind === 'projects')!
    assert.equal(prj.entries?.length, 4)
    const commented = prj.entries![0].bullets[1]
    assert.match(commented.comment ?? '', /TODO: insert dataset size/)
    assert.ok(!commented.body.includes('%'))
  })
  test('skills lines', () => {
    const sk = doc.sections.find((s) => s.kind === 'skills')!.skills!
    assert.equal(sk.lines.length, 6)
    assert.equal(sk.lines[1].category, 'Backend \\& APIs')
  })
})

describe('fact bank', () => {
  const facts = buildFacts(parseResume(BASE))
  test('contact and structure', () => {
    assert.equal(facts.name, 'ALEX MORGAN')
    assert.equal(facts.email, 'alex.morgan@example.com')
    assert.match(facts.phone, /9000000000/)
    assert.equal(facts.experience.length, 3)
    assert.equal(facts.projects.length, 4)
    assert.equal(facts.experience[0].title, 'Full Stack & AI/ML Developer')
    assert.equal(facts.experience[0].org, 'BeetLoop Global Solutions Pvt Ltd')
    assert.equal(facts.experience[0].dates, 'Apr 2026 – Present')
    assert.equal(facts.projects[0].title, 'Periodontitis Detection System — ML Inference REST Service')
  })
  test('ids are unique and stable', () => {
    const ids = [...facts.experience, ...facts.projects].map((e) => e.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(buildFacts(parseResume(BASE)).experience.map((e) => e.id), facts.experience.map((e) => e.id))
  })
  test('metrics and skills per bullet', () => {
    assert.deepEqual(facts.experience[0].bullets[1].metrics, ['50'])
    assert.ok(facts.projects[2].bullets[1].metrics.includes('100000'))
    assert.ok(facts.projects[2].bullets[1].metrics.includes('0.92'))
    assert.ok(facts.experience[0].bullets[0].skills.includes('Spring Boot'))
    assert.ok(facts.all_skills.includes('C#'))
  })
  test('metric extraction normalises', () => {
    assert.deepEqual(extractMetrics('cut 50\\% and 1,000+ users at 20 FPS'), ['50', '1000', '20'])
  })
  test('overlay extras are included', () => {
    const f = buildFacts(parseResume(BASE), { extra_bullets: { [facts.experience[0].id]: [{ id: 'x1', text: 'Mentored 2 interns on Kafka basics.' }] }, inventory_extra: ['Kafka'], locked: [] })
    assert.equal(f.experience[0].bullets.at(-1)?.extra, true)
    assert.ok(f.all_skills.includes('Kafka'))
  })
})

describe('tailoring guards', () => {
  const doc = parseResume(BASE)
  const facts = buildFacts(doc)
  const exp0 = facts.experience[0]
  const plan = (p: Partial<TailorPlan>): TailorPlan => ({ summary: null, skills: null, experience: [], projects: [], notes: [], ...p })

  test('valid rewrite passes', () => {
    const { plan: out, flags } = guardPlan(
      plan({ experience: [{ id: exp0.id, bullets: [{ ref: 'b2', text: 'Containerised backend services with Docker and shipped them via CI/CD, reducing deployment-related defects by 50%.' }, { ref: 'b1' }] }] }),
      facts,
    )
    assert.equal(out.experience[0].bullets[0].text?.includes('50%'), true)
    assert.ok(!flags.some((f) => f.level === 'reject'))
  })
  test('invented metric is rejected and the original kept', () => {
    const { plan: out, flags } = guardPlan(plan({ experience: [{ id: exp0.id, bullets: [{ ref: 'b2', text: 'Cut deployment defects by 70% using Docker and CI/CD.' }, { ref: 'b1' }] }] }), facts)
    assert.equal(out.experience[0].bullets[0].text, null)
    assert.ok(flags.some((f) => f.level === 'reject' && /70/.test(f.message)))
  })
  test('invented technology is rejected', () => {
    const { plan: out, flags } = guardPlan(plan({ experience: [{ id: exp0.id, bullets: [{ ref: 'b1', text: 'Built backend features with Java, Spring Boot and Kafka.' }, { ref: 'b2' }] }] }), facts)
    assert.equal(out.experience[0].bullets[0].text, null)
    assert.ok(flags.some((f) => /Kafka/.test(f.message)))
  })
  test('unknown entries/refs are ignored; every role kept; min 2 bullets', () => {
    const { plan: out, flags } = guardPlan(plan({ experience: [{ id: 'exp_fake', bullets: [] }, { id: exp0.id, bullets: [{ ref: 'b9' }, { ref: 'b1' }] }] }), facts)
    assert.equal(out.experience.length, 3)
    assert.equal(out.experience[0].bullets.length, 2)
    assert.ok(flags.some((f) => /Unknown/.test(f.message)))
    assert.ok(flags.some((f) => /does not exist/.test(f.message)))
  })
  test('summary with invented skill is dropped', () => {
    const { plan: out } = guardPlan(plan({ summary: 'Backend engineer skilled in Rust and Kafka.' }), facts)
    assert.equal(out.summary, null)
  })
  test('skills: unknown items removed, forgotten categories kept', () => {
    const { plan: out, flags } = guardPlan(plan({ skills: [{ category: 'Backend & APIs', items: ['Spring Boot', 'FastAPI', 'Kafka'] }] }), facts)
    assert.deepEqual(out.skills![0].items, ['Spring Boot', 'FastAPI'])
    assert.equal(out.skills!.length, facts.skills.length)
    assert.ok(flags.some((f) => /Kafka/.test(f.message)))
  })
  test('drift metric', () => {
    assert.equal(drift('built java services', 'built java services'), 0)
    assert.ok(drift('built java services', 'led a marketing campaign') > 0.9)
  })
  test('plan validation rejects malformed output', () => {
    assert.throws(() => validatePlan({ experience: 'x' }), /experience must be an array/)
    assert.throws(() => validatePlan({ experience: [{ id: 1, bullets: [] }] }), /id must be a string/)
    const ok = validatePlan({ summary: '  ', skills: null, experience: [], projects: [], notes: ['a', 3] })
    assert.equal(ok.summary, null)
    assert.deepEqual(ok.notes, ['a'])
  })
})

describe('applying a plan', () => {
  const doc = parseResume(BASE)
  const facts = buildFacts(doc)
  test('identity plan only removes comments and forced breaks', () => {
    const out = renderResume(applyPlan(doc, identityPlan(facts, 4), facts, { removeForcedBreaks: true }))
    assert.ok(!/\\newpage/.test(out))
    assert.ok(!/% TODO: insert dataset size/.test(out))
    assert.ok(out.includes('reducing deployment-related defects by 50\\%'))
    // untouched sections stay byte-identical
    const cert = doc.sections.find((s) => s.kind === 'certifications')!
    assert.ok(out.includes(cert.heading + cert.body))
  })
  test('rewrites are escaped, reordered, projects selected', () => {
    const exp0 = facts.experience[0]
    const p: TailorPlan = {
      summary: 'Backend engineer focused on Java & Spring Boot APIs.',
      skills: null,
      experience: [{ id: exp0.id, bullets: [{ ref: 'b2', text: 'Shipped Docker services via CI/CD, cutting defects by 50%.' }, { ref: 'b1' }] }],
      projects: [{ id: facts.projects[1].id, bullets: [{ ref: 'b1' }, { ref: 'b5' }] }],
      notes: [],
    }
    const out = renderResume(applyPlan(doc, p, facts, { removeForcedBreaks: true }))
    assert.ok(out.includes('{Shipped Docker services via CI/CD, cutting defects by 50\\%.}'))
    assert.ok(out.includes('Backend engineer focused on Java \\& Spring Boot APIs.'))
    assert.ok(!out.includes('Periodontitis'))
    assert.ok(out.includes('AI Course Builder'))
    const i1 = out.indexOf('Shipped Docker')
    const i2 = out.indexOf('Design, implement, test')
    assert.ok(i1 > 0 && i1 < i2, 'bullet order follows the plan')
    // other roles untouched
    assert.ok(out.includes('Hirola InfoTech Solutions'))
    assert.ok(out.trimEnd().endsWith('\\end{document}'))
  })
  test('reordered bullets keep consistent indentation', () => {
    const prj = facts.projects[1]
    const p: TailorPlan = { summary: null, skills: null, experience: [], projects: [{ id: prj.id, bullets: [{ ref: 'b5' }, { ref: 'b1' }, { ref: 'b3' }] }], notes: [] }
    const out = renderResume(applyPlan(doc, p, facts))
    const block = out.slice(out.indexOf('AI Course Builder'), out.indexOf('\\resumeItemListEnd', out.indexOf('AI Course Builder')))
    const indents = block.split('\n').filter((l) => /\\item\b/.test(l)).map((l) => /^\s*/.exec(l)![0])
    assert.equal(indents.length, 3)
    assert.equal(new Set(indents).size, 1, JSON.stringify(indents))
  })
})

describe('base-resume linter', () => {
  const issues = lintBase(BASE, { github: 'https://github.com/alexmorgan-dev', current_location: 'Chennai, India', email: 'alex.morgan@example.com' })
  const kinds = issues.map((i) => i.kind)
  test('finds the known problems in the base', () => {
    assert.equal(issues.filter((i) => i.kind === 'todo').length, 2)
    assert.ok(kinds.includes('unverified_claim'))
    assert.ok(kinds.includes('link_owner'))
    assert.ok(kinds.includes('header_city'))
    assert.ok(kinds.includes('ats_unicode'))
    assert.ok(kinds.includes('forced_break'))
    assert.equal(issues.filter((i) => i.kind === 'empty_link').length, 2)
    assert.equal(issues.filter((i) => i.kind === 'bullet_note').length, 3)
    assert.ok(kinds.includes('instruction_comments'))
    assert.ok(!kinds.includes('email_mismatch'))
    assert.ok(hasBlockingIssues(issues))
  })
  test('blocking issues sort first', () => {
    assert.equal(issues[0].severity, 'block')
  })
  test('resolving every blocking issue clears the block', () => {
    let src = BASE
    const fix = (kind: string, action: string, value = '') => {
      const issue = lintBase(src, { github: 'https://github.com/alexmorgan-dev' }).find((i) => i.kind === kind)!
      assert.ok(issue, kind)
      src = resolveIssue(src, issue, action, value)
    }
    fix('todo', 'set', 'May 2026')
    assert.ok(src.includes('{2022 -- May 2026}'))
    fix('todo', 'set', '8.6')
    assert.ok(src.includes('{CGPA: 8.6}'))
    fix('unverified_claim', 'remove')
    assert.ok(src.includes('{: Java, Python, SQL, JavaScript}'))
    assert.ok(!src.includes('IMPORTANT NOTE'))
    const after = lintBase(src, { github: 'https://github.com/alexmorgan-dev' })
    assert.ok(!hasBlockingIssues(after), JSON.stringify(after.filter((i) => i.severity === 'block')))
    // still parses and round-trips
    assert.equal(renderResume(parseResume(src)), src)
  })
  test('one-click fixes', () => {
    const iss = (k: string) => lintBase(BASE, { current_location: 'Chennai, India' }).find((i) => i.kind === k)!
    assert.match(resolveIssue(BASE, iss('ats_unicode'), 'fix', ''), /\\pdfgentounicode=1\n\n\\begin\{document\}/)
    assert.match(resolveIssue(BASE, iss('header_city'), 'add_city', '', { current_location: 'Chennai, India' }), /Ph: \+91-\\phone \$\\vert\$ Chennai, India\\\\/)
    assert.ok(!/\\newpage/.test(resolveIssue(BASE, iss('forced_break'), 'remove', '')))
    assert.match(resolveIssue(BASE, iss('empty_link'), 'label', ''), /\\textcolor\{blue\}\{Certificate\}/)
    assert.match(resolveIssue(BASE, iss('link_owner'), 'team', ''), /\$\\vert\$ Team \$\\vert\$ \\href\{https:\/\/github\.com\/sashankbanda/)
    assert.throws(() => resolveIssue(BASE, iss('todo'), 'set', '  '), /Enter a value/)
  })
  test('dismissed issues stay hidden', () => {
    const id = issues.find((i) => i.kind === 'forced_break')!.id
    assert.ok(!lintBase(BASE, {}, [id]).some((i) => i.id === id))
  })
})

// ---------------------------------------------------------------- form answers

const ANSWERS: ApplyAnswers = {
  citizenship: 'Indian', authorized_india: 'Yes', other_countries: '', sponsorship_now: 'No', sponsorship_future: 'Yes',
  notice_period: '30 days', start_date: 'Immediately', currency: 'INR', current_ctc: '', expected_ctc: '1200000',
  salary_text: 'Negotiable', leave_salary_blank: true, relocation: 'Yes', work_modes: ['Onsite', 'Hybrid'], travel: '',
  gender: '', pronouns: '', race: '', veteran: '', disability: '', hear_about: 'Company careers page', languages: 'English, Telugu',
  over_18: 'Yes', background_check: 'Yes', always_ask: ['background_check'],
}

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  profile: { full_name: 'Alex Morgan', email: 'alex@example.com', phone: '+91 9000000000', linkedin: 'https://linkedin.com/in/alex', github: 'https://github.com/alex', current_location: 'Chennai, India', college: 'VIT Chennai', degree: 'B.Tech CSE', experience_years: '1 year' },
  answers: ANSWERS,
  bank: [{ question_norm: 'what is your favourite programming language', answer: 'Java', field_type: 'text' }],
  mappings: [],
  atsType: 'greenhouse',
  resumePdf: '/tmp/Alex_Morgan_Resume.pdf',
  resumeFileName: 'Alex_Morgan_Resume.pdf',
  ...over,
})

const field = (label: string, over: Partial<FormField> = {}): FormField => ({ id: 's0f1', kind: 'text', input_type: 'text', label, name: '', required: true, options: [], max_length: null, multiple: false, step: 0, ...over })

describe('answer resolver', () => {
  test('profile fields', () => {
    assert.equal(resolveField(field('First Name *'), ctx()).value, 'Alex')
    assert.equal(resolveField(field('Last name'), ctx()).value, 'Morgan')
    assert.equal(resolveField(field('Email'), ctx()).value, 'alex@example.com')
    assert.equal(resolveField(field('E-mail *'), ctx()).value, 'alex@example.com')
    assert.equal(resolveField(field('Are you willing to work on-site?', { kind: 'radio', options: ['Yes', 'No'] }), ctx()).value, 'Yes')
    assert.equal(resolveField(field('LinkedIn Profile'), ctx()).source, 'profile')
    assert.equal(resolveField(field('Years of experience', { input_type: 'number' }), ctx()).value, '1')
  })
  test('someone else’s name is never filled from your profile', () => {
    const r = resolveField(field('Referrer name'), ctx())
    assert.notEqual(r.value, 'Alex Morgan')
  })
  test('resume upload uses the locked PDF; optional cover letter skipped', () => {
    const r = resolveField(field('Resume/CV', { kind: 'file' }), ctx())
    assert.equal(r.value, '/tmp/Alex_Morgan_Resume.pdf')
    assert.equal(resolveField(field('Cover Letter', { kind: 'file', required: false }), ctx()).needs_you, false)
  })
  test('application answers with option matching', () => {
    const auth = resolveField(field('Are you legally authorized to work in India?', { kind: 'select', options: ['Select...', 'Yes', 'No'] }), ctx())
    assert.equal(auth.value, 'Yes')
    assert.equal(auth.source, 'answers')
    const spon = resolveField(field('Will you now or in the future require sponsorship?', { kind: 'radio', options: ['Yes', 'No'] }), ctx())
    assert.equal(spon.value, 'Yes') // "future" → sponsorship_future
    const remote = resolveField(field('Are you open to working remote?', { kind: 'radio', options: ['Yes', 'No'] }), ctx())
    assert.equal(remote.value, 'No')
  })
  test('EEO defaults to decline', () => {
    const r = resolveField(field('Gender', { kind: 'select', options: ['Male', 'Female', 'Decline To Self Identify'] }), ctx())
    assert.equal(r.value, 'Decline To Self Identify')
  })
  test('attestations always need you', () => {
    const r = resolveField(field('I certify that the information provided is true and complete', { kind: 'checkbox', options: ['I certify'] }), ctx())
    assert.equal(r.needs_you, true)
    assert.ok(ATTESTATION_RE.test(normQuestion('I agree to the Privacy Policy')))
  })
  test('"always ask me" is respected', () => {
    const r = resolveField(field('Are you willing to undergo a background check?', { kind: 'radio', options: ['Yes', 'No'] }), ctx())
    assert.equal(r.needs_you, true)
    assert.match(r.note ?? '', /Always ask/)
  })
  test('optional salary left blank when configured', () => {
    const r = resolveField(field('Current CTC', { required: false }), ctx())
    assert.equal(r.value, '')
  })
  test('answer bank exact and fuzzy', () => {
    assert.equal(resolveField(field('What is your favourite programming language?'), ctx()).source, 'answer_bank')
    assert.equal(resolveField(field('Your favourite programming language — what is it?'), ctx()).source, 'answer_bank')
  })
  test('open questions are queued for an AI draft; unknown required needs you', () => {
    assert.equal(resolveField(field('Why do you want to join Acme?', { kind: 'textarea' }), ctx()).note, 'pending-generation')
    const u = resolveField(field('Shoe size'), ctx())
    assert.equal(u.needs_you, true)
    assert.equal(resolveField(field('Shoe size', { required: false }), ctx()).needs_you, false)
  })
  test('learned mapping wins', () => {
    const f = field('Profile URL', { name: 'question_88' })
    const r = resolveField(f, ctx({ mappings: [{ field_sig: 'profile url|question_88', profile_key: 'linkedin' }] }))
    assert.equal(r.value, 'https://linkedin.com/in/alex')
    assert.equal(r.source, 'mapping')
  })
  test('option matcher families', () => {
    assert.equal(matchOption('Yes', ['No', 'Yes, I am']), 'Yes, I am')
    assert.equal(matchOption('B.Tech CSE', ["High school", "Bachelor's Degree", "Master's Degree"]), "Bachelor's Degree")
    assert.equal(matchOption('1', ['0-1 years', '1-3 years', '3+ years']), '0-1 years')
    assert.equal(matchOption('7', ['0-1 years', '1-3 years', '5+ years']), '5+ years')
    assert.equal(matchOption('Decline to self-identify', ['Male', 'Female', 'I don\'t wish to answer']), "I don't wish to answer")
    assert.equal(matchOption('Purple', ['Red', 'Blue']), null)
  })
  test('college and company "name" questions are your details, not a person', () => {
    assert.equal(resolveField(field('College name *'), ctx()).value, 'VIT Chennai')
    assert.equal(resolveField(field('Name of your university'), ctx()).value, 'VIT Chennai')
    const co = resolveField(field('Current company name'), ctx({ profile: { ...ctx().profile, current_company: 'Acme Labs' } }))
    assert.equal(co.value, 'Acme Labs')
    // Other people's names still aren't filled with yours.
    for (const q of ["Father's name", 'Reference name', 'Recruiter name', 'Emergency contact name']) {
      assert.notEqual(resolveField(field(q), ctx()).value, 'Alex Morgan', q)
    }
    assert.equal(resolveField(field('Full name'), ctx()).value, 'Alex Morgan')
  })
  test('country and phone country code', () => {
    const country = resolveField(field('Country', { kind: 'select', options: ['Select...', 'India', 'United States'] }), ctx())
    assert.equal(country.value, 'India')
    const code = resolveField(field('Phone country code', { kind: 'select', options: ['United States (+1)', 'India (+91)'] }), ctx())
    assert.equal(code.value, 'India (+91)')
    assert.equal(resolveField(field('Phone'), ctx()).value, '+91 9000000000')
  })
  test('Profile values fill in when Application answers are empty', () => {
    const a = { ...ANSWERS, notice_period: '', current_ctc: '' }
    const p = { ...ctx().profile, notice_period: '15 days', current_ctc: '600000' }
    assert.equal(resolveField(field('What is your notice period?'), ctx({ answers: a, profile: p })).value, '15 days')
    assert.equal(resolveField(field('Current CTC'), ctx({ answers: a, profile: p })).value, '600000')
    // Your Application answer still wins.
    assert.equal(resolveField(field('What is your notice period?'), ctx({ profile: p })).value, '30 days')
  })
  test('helpers', () => {
    assert.ok(tokenSetRatio('Are you authorized to work in India', 'authorized to work in India?') > 0.8)
    assert.equal(planReady({ a: { field_id: 'a', value: 'x', source: 'profile', confidence: 'high', needs_you: false, note: null, filled: true } }), true)
  })
})
