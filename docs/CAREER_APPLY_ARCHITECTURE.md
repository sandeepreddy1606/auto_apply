# Career-Page Apply Flow — Architecture

Status: **proposal, for review** · 2026-11-08 · scope: career-page jobs only (Telegram and WhatsApp come later and reuse the same apply engine)

```
 Jobs ──▶ Job detail ──▶ [Apply] ──▶ ① Resume Studio ──▶ ② Autofill ──▶ ③ Review ──▶ ④ Submit ──▶ ⑤ Tracked
 (all     (full JD,                  base LaTeX →        fill plan      screenshot    you click   confirmation,
  jobs,    match score)              tailored LaTeX →    executed in    + every       or approve  resume version,
  filter)                            PDF + ATS report    a real browser field shown               answers, events
```

---

## 0. Lessons from existing products

| Product | What it does well | What goes wrong | What we take |
|---|---|---|---|
| **Simplify Copilot** | Browser extension autofills 100+ ATS forms in *your* browser. You review and click submit. | Free-text answers are weak and it has no per-job resume | **Fill in a real browser with human review.** Keep per-ATS adapters plus a generic fallback. |
| **Teal / Rezi / Kickresume** | "Master resume" with everything, plus a tailored copy per job. Keyword-match score. | Template lock-in. AI rewrites drift away from the truth. | A **master fact bank**, with per-job versions derived from it. Show the keyword score before and after. |
| **Jobscan** | "Match rate": JD keywords vs resume, missing keywords, ATS parse check | Analysis only, no generation | The **ATS report**: run the PDF through a parser and check keywords and sections |
| **Overleaf** | LaTeX editor next to a live PDF preview | — | **Split-pane editor + live compiled preview** |
| **LazyApply / AIHawk (open source)** | Unattended mass auto-submit | Mass applications get ignored, accounts get flagged, CAPTCHAs block it, the AI invents experience | **Never unattended mass-submit.** No invented facts. Every submission is reviewed. |
| **Huntr** | Kanban tracker, saves jobs with the JD | No autofill | **A snapshot of the JD and the exact resume sent**, stored per application |
| **Resume-Matcher (OSS)** | Keyword extraction + similarity scoring | — | Deterministic keyword scoring (no LLM needed) |

**Core principle:** AI drafts, deterministic code validates, you approve. Nothing is submitted that you haven't seen, and no resume claim exists that isn't in your fact bank.

---

## 1. Jobs: see everything

The current scanner stores only the title and URL. It changes to:

- **Store every job, not only matched ones.** The `matched` flag becomes a `match_score` (0–100). The Jobs page has an "All / Relevant" toggle, filters (company, location, posted date, score, state) and search.
- **Fetch the full JD** for every new job. Most boards give it for free:
  - Greenhouse: `…/jobs?content=true`
  - Lever: `descriptionPlain` + `lists`
  - Ashby: `descriptionHtml`
  - Workable: job detail endpoint
  - SmartRecruiters: `/postings/{id}`
  - Workday: `/wday/cxs/{tenant}/{site}/job/{path}`
  - Other sites: render the page with Playwright and use a readability-style extractor.
- The JD is stored as sanitized HTML plus plain text, which feeds keyword extraction and scoring.
- **Job detail page:** JD, score breakdown, the keywords you have and the ones you're missing, the ATS type, any previous applications to this company, and the **Apply** button.

---

## 2. Resume Studio (LaTeX)

### 2.1 Building blocks

| Piece | Choice | Why |
|---|---|---|
| Base resume | Your existing `.tex`, pasted or uploaded once and stored as **Base v1** (versioned) | You keep your look |
| Fact bank | Structured JSON extracted from the base once, then editable: experiences, projects, bullets, skills, metrics, education. You can add bullets that don't fit on one page. | The tailoring step may only **select and rephrase** from this, never invent |
| Compiler | **Tectonic** (single binary, fetches packages on demand, deterministic) running in the worker | Much lighter than full TeX Live in Docker |
| Editor | **CodeMirror 6** with LaTeX syntax, error gutter (compile errors mapped to line numbers) and diff view | Fast, works on mobile |
| Preview | **pdf.js** rendering the compiled PDF and recompiling on save (debounced) | Overleaf-style |
| Generator | Claude through the **LLM provider layer** (§2.5): your Claude Pro login via the local Claude Code CLI by default, an API key optionally. Strict output contract (§2.3). | No extra bill on Pro. You can swap the backend without touching the rest of the app. |

### 2.2 Studio flow (opens when you hit Apply)

```
┌─ Resume for: Backend Engineer @ Stripe ────────────────────────────────┐
│ Source: [Base v3 ▾]  [Reuse: "SDE-2 @ Razorpay" version (92% similar)] │
│ [✨ Generate tailored]  [Compile]  [Diff vs base]  [Use this resume →] │
├──────────── LaTeX editor ──────────┬────────── PDF preview ────────────┤
│ \section{Experience}               │  ┌────────────────────────┐       │
│ \resumeItem{Built payment ...}     │  │  Rendered PDF (pdf.js) │       │
│  ...                               │  └────────────────────────┘       │
├────────────────────────────────────┴───────────────────────────────────┤
│ ATS report  Keyword match 58% → 87% · Parsed OK · 1 page · 0 warnings  │
│ Missing: gRPC, Kafka (not in fact bank: add if true)                    │
│ ⚠ Changed claims: "led team of 5" (base said "team of 4") → review     │
└────────────────────────────────────────────────────────────────────────┘
```

On mobile the editor, preview and report become three tabs.

### 2.3 Generation pipeline (no invented facts)

1. **Analyze JD** (deterministic): extract required and preferred skills, seniority, and repeated key phrases, using a skill dictionary plus n-gram frequency.
2. **Plan** (LLM, JSON output): which experiences and projects to include, bullet order, which bullets to rewrite to surface JD keywords, and a summary line. Each rewritten bullet must cite the `fact_id` it came from.
3. **Render** (deterministic): the plan plus the fact bank go into your **base template**. The template is the base `.tex` with its content regions marked, done once at setup and assisted by the LLM. The LLM never controls preamble or layout, so compilation stays reliable and the design never drifts.
   - *Fallback:* if your base can't be turned into a template, the LLM edits the full `.tex`, and the output is accepted only if it compiles and passes the guards.
4. **Guards** (deterministic):
   - Every number, company, title and date in the output must exist in the fact bank. Otherwise it's flagged ⚠.
   - Skills added must be in your skills list. Otherwise they're listed as "missing — add if true".
   - The page count must match the base (usually 1).
5. **Compile** with Tectonic. On error, the error log goes back to the LLM for one automatic repair attempt, then to you.
6. **ATS check:**
   - Extract text from the PDF with `pdftotext`.
   - Verify contact info, standard headings (Experience/Education/Skills), reading order and that there are no ligature or glyph problems (the template enforces `\pdfgentounicode=1` and `glyphtounicode`).
   - Compute keyword coverage before and after.

ATS-friendly template rules: single column, standard section names, no tables, icons or images for content, real text bullets, standard fonts, selectable text, `.pdf` named `Firstname_Lastname_Resume.pdf`.

### 2.4 Versioning

- Every generation and every save creates a `resume_version` (parent → child), so you can always diff and roll back.
- Clicking **Use this resume** *locks* that version to the application. The tracker shows exactly what was sent.
- **Reuse:** before generating, the app finds earlier versions for similar JDs (keyword cosine similarity) and offers them. That saves cost and keeps you consistent.

### 2.5 LLM provider layer (Claude Pro by default)

Every AI call in the app goes through one interface:

```ts
interface LlmProvider {
  generateJson<T>(req: { system: string; prompt: string; schema: JSONSchema; model?: 'sonnet' | 'opus' }): Promise<T>
}
```

| Provider | How it works | Cost | Where it works |
|---|---|---|---|
| **`claude-code`** (default) | The worker runs your locally installed Claude Code CLI, logged in with **your Claude Pro account**: `claude -p --output-format json --json-schema <schema> --tools "" --system-prompt <…> --no-session-persistence --model sonnet`. The prompt goes in on stdin and validated JSON comes out on stdout. | Included in Pro; uses your Pro usage limits | Any machine where you ran `claude` and logged in once (your laptop, or the server if you log in there) |
| `manual` | The app shows the prompt with a **Copy** button. You paste it into claude.ai, then paste the answer back. The app validates it the same way. | Free | Anywhere, including your phone |
| `anthropic-api` (optional, later) | Official SDK with an API key | Pay per use | Anywhere |

Rules for the `claude-code` provider:
- **Tools disabled** (`--tools ""`) so the call is a pure text-in/JSON-out generation that can't touch files.
- **Your normal login is used.** Never `--bare`, which skips OAuth. The app never reads, copies or stores your Claude login token; it only runs the official CLI as you.
- **It runs one call at a time.** It times out after 120 s. If it fails or hits the Pro limit ("usage limit reached"), it falls back to the `manual` provider and the UI tells you.
- **Rate fits Pro:** about 1 call per tailored resume plus 0–1 per form (only when there are open-ended questions). Results are cached by input hash, so a regenerate with no changes costs nothing.
- Settings → AI shows the provider status ("Claude Code 2.1.81 · logged in"), a test button and a calls-used-today counter.

---

## 3. Autofill engine

### 3.1 One "fill plan", two executors

The **brain** runs on the server: it reads the form schema, decides every answer and records confidence. The **hands** are interchangeable:

| Executor | Where it runs | Best for | Mobile? |
|---|---|---|---|
| **Server (Playwright)** | Worker process, real Chromium | Greenhouse, Lever, Ashby, Workable, SmartRecruiters (no login needed). One click from anywhere. | ✅ Live screenshots streamed to the phone |
| **Extension** (upgrade of the current one) | Your Chrome/Edge | Workday, iCIMS, Taleo, SuccessFactors (need a login), CAPTCHA pages, anything the server can't open | Laptop only |

Both run the **same fill plan**, so behavior and learning are identical. The extension can attach the resume PDF too. A content script can build a `File`, set it on the `<input type=file>` through `DataTransfer`, and dispatch `change`. The current README says this is impossible; that is outdated.

### 3.2 Pipeline

```
open apply URL ─▶ detect ATS ─▶ extract form schema ─▶ build fill plan ─▶ execute ─▶ verify ─▶ review
                    (URL/DOM)     (adapter or generic)   (resolver chain)   (type,     (read back
                                                                            select,    values,
                                                                            upload)    errors)
```

**Form schema extraction:**
- *ATS adapter:* known selectors and structure, e.g. Greenhouse `#first_name`, `#resume` upload, `#question_*`; Lever `input[name=name]`, `cards[...]`; Ashby `_systemfield_*`.
- *Generic:* walk the accessibility tree and use `<label for>`, `aria-label`, `aria-labelledby`, placeholder text and nearby text. Field types: text, textarea, select, combobox, radio, checkbox, file, date.
- Multi-step forms: the adapter defines "next page" actions, and the schema is extracted per page.

**Resolver chain** (the first resolver that is confident wins; each answer records `source` and `confidence`):

| # | Resolver | Example | Confidence |
|---|---|---|---|
| 1 | Learned field mapping (ATS + selector → profile key, from your past corrections) | Greenhouse `#question_123` → `linkedin` | high |
| 2 | Profile rules (existing `rules.js` / `gform.ts` regexes, unified into one shared module) | "Notice period" → `notice_period` | high |
| 3 | **Answer bank**: normalized question text plus fuzzy match to your past answers | "Are you authorized to work in India?" → "Yes" | high (exact), medium (fuzzy) |
| 4 | Option matcher for selects and radios (normalize, then synonyms like "Bachelor's" ↔ "B.Tech") | Degree dropdown | medium |
| 5 | Policy defaults you set once | EEO, gender, race, veteran → "Decline to self-identify" | high |
| 6 | **LLM draft** for open questions, using JD + your resume version + company. Always flagged for review. | "Why do you want to join Stripe?" | review |
| 7 | Unknown | — | **needs you** |

**Learning loop:** every value you change or type during review is written back. Question → answer goes into the answer bank, and selector → key goes into the field mappings. The next application with the same question fills it automatically. *This is the main thing that makes it improve over time.*

### 3.3 Review and submit (always a human step)

```
┌─ Review: Backend Engineer @ Stripe (Greenhouse) ───────────────────────┐
│ [live screenshot of the filled form]                                    │
│ ✅ 14 filled from profile   🧠 3 from answer bank   ✍ 2 AI drafts (edit) │
│ ❗ 1 needs you: "Expected start date"  [____]                            │
│ Resume: Stripe_Backend_v2.pdf ✓ uploaded                                │
│                                   [Edit answers] [Submit application ▶] │
└────────────────────────────────────────────────────────────────────────┘
```

- **Server executor:** the Playwright page stays alive for up to 15 minutes while you review. Your edits are applied to the live page, then **Submit** clicks the real button. If the session expires, the app replays the plan, which is deterministic.
- **Extension executor:** you see the same panel in the page, and you click submit.
- **CAPTCHA detected:** the app never bypasses it. With the server executor, the job is handed off with "Open in your browser" and the extension continues with the same plan.
- **Confirmation:** the app detects the thank-you page, URL change or success toast. It stores the final screenshot and marks the application `submitted`. If it can't detect one, it asks "Did it go through? Yes/No".

### 3.4 Guardrails

- Duplicate check: already applied to this job, or to this company in the last N days → warning.
- Daily cap (default 25) and one active session per company domain.
- No stealth or fingerprint evasion. Real browser, normal speed. If a site blocks automation, the job moves to the extension.
- Every submission keeps: JD snapshot, resume version, all answers with their sources, screenshots and timestamps.

---

## 4. Tracking (events for every step)

```
apply_session status:
 resume_pending → resume_ready → filling → needs_input ⇄ reviewing → submitting → submitted
                                     └→ blocked (captcha/login) → handed_to_extension → submitted
                                     └→ failed (retryable)
after submit (application.stage): applied → screening → interview → offer | rejected | ghosted
```

Every transition writes to `application_events` (actor, timestamp, data), and the timeline UI is built from those rows. The dashboard shows a funnel per company and ATS, the average time to apply, and how many answers came from the bank vs from you (a measure of how well the system is learning).

---

## 5. Data model (new / changed)

```
company_jobs (+) description_html, description_text, posted_at, ats_type,
                 ats_job_id, match_score, match_breakdown json, keywords json

resume_bases     id, name, latex, template_latex, is_default, created_at
fact_bank        id, base_id, data json (experiences[], projects[], skills[], edu[]), updated_at
resume_versions  id, base_id, parent_id, job_id NULL, latex, pdf_path, page_count,
                 ats_report json, generated_by (user|llm), llm_plan json, status (draft|locked),
                 created_at
apply_sessions   id, job_id, resume_version_id, executor (server|extension), status,
                 ats_type, form_schema json, fill_plan json, screenshots json,
                 error, started_at, submitted_at
application_events id, session_id, type, actor, data json, at
answer_bank      id, question_norm, question_raw, answer, field_type, ats_type NULL,
                 company_id NULL, uses, last_used_at
field_mappings   id, ats_type, selector_sig, label_norm, profile_key, uses
policy_answers   key (eeo_gender, work_auth, sponsorship…), value
```

---

## 6. Components and code layout

```
lib/
  jobs/          jd-fetch per ATS, jd-extract (readability), keywords, scoring
  resume/
    template.ts  mark regions in base .tex, render plan → .tex
    facts.ts     fact-bank extraction + validation
    tailor.ts    JD analysis → LLM plan → render → guards
    compile.ts   tectonic runner (sandboxed, timeout, no shell-escape)
    ats-check.ts pdftotext + heuristics + keyword coverage
  apply/
    schema/      ats adapters (greenhouse, lever, ashby, workable, smartrecruiters,
                 workday) + generic a11y extractor
    resolve/     resolver chain (mapping, rules, answer-bank, options, policy, llm)
    plan.ts      FillPlan type: [{field, value, source, confidence}]
    exec/server.ts     Playwright executor + live session registry
    exec/extension.ts  API the extension pulls plans from / reports back to
    learn.ts     write-back of your corrections
  llm/           Claude client, prompt templates, JSON schema validation, cost log
worker/          queue consumers: jd_fetch, tailor, compile, fill, submit
app/
  jobs/            list + detail
  apply/[sessionId]/  stepper: Resume → Fill → Review → Done
  resumes/         base, fact bank, versions
  settings/answers/  answer bank + policy answers
extension/       Manifest V3, content script for all supported ATS domains, same plan format
```

LaTeX compile security: Tectonic runs with `-Z shell-escape` **off**, inside a temp directory, with a CPU and time limit. `\input` and `\include` are blocked outside that directory.

---

## 7. Build order

| Step | Deliverable | You can… |
|---|---|---|
| 1 | Store all jobs, fetch JDs, scoring, new Jobs list and detail (responsive) | See every job with its full description and match score |
| 2 | Resume Studio: base LaTeX, editor, Tectonic compile, PDF preview, versions | Edit and compile your resume per job |
| 3 | Tailoring: fact bank, LLM plan, render, guards, ATS report, reuse | Click "Generate" and get an ATS-friendly tailored LaTeX |
| 4 | Autofill brain: schema adapters (Greenhouse, Lever, Ashby first), resolver chain, answer bank | See a complete fill plan for a job |
| 5 | Server executor + live review + submit + confirmation | Apply end to end from laptop or phone |
| 6 | Extension executor (Workday etc.), CAPTCHA hand-off, learning dashboard | Cover login-based ATS |

---

## 8. What I need from you

1. **Your base resume `.tex`** (plus any custom `.cls` or `.sty` it uses).
2. **Claude Code logged in with your Pro account** on the machine that runs the worker. Run `claude` once and sign in. No API key is needed. Everything other than resume tailoring and open-ended answers is deterministic.
3. **Policy answers:** work authorization and sponsorship, EEO preference, earliest start date, relocation.
4. **A few target companies** to test against, ideally one each on Greenhouse, Lever, Ashby and Workday.
