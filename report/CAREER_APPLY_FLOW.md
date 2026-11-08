# Career-Page Apply Flow — Production Architecture

| | |
|---|---|
| Status | Final design, rev 2: every user input is configured in the app's Settings (§10). Ready to build. |
| Date | 2026-11-08 |
| Scope | Company career pages: discover jobs → tailor resume (LaTeX) → autofill → review → submit → track |
| Out of scope for now | Telegram/WhatsApp (they reuse the apply engine later), LinkedIn referrals |
| Supersedes | `docs/CAREER_APPLY_ARCHITECTURE.md` (draft) |

---

## Implementation status (2026-11-08)

Phases 1–4 are built and tested, plus most of phase 5's tracking. All 15 rows below are implemented.

| Area | Built | Where |
|---|---|---|
| Migrations, task queue, worker + supervisor | ✅ | `lib/server/migrations.ts`, `lib/tasks/`, `worker/index.ts`, `lib/server/worker-supervisor.ts` |
| Store all jobs, JD fetch (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, **Workday**, JSON-LD / main-content / headless-render fallback) | ✅ | `lib/server/scanner.ts`, `lib/jobs/jd.ts` |
| ATS detection incl. boards embedded on custom career pages | ✅ | `lib/jobs/ats.ts` |
| Explainable score, hard filters, live preview count, rescoring | ✅ | `lib/jobs/score.ts`, `lib/jobs/analyze.ts`, `lib/jobs/store.ts` |
| Lossless LaTeX parser/renderer for your template | ✅ | `lib/resume/latex/` |
| Fact bank + overlay (extra bullets, skills inventory) | ✅ | `lib/resume/facts.ts` |
| Base-resume linter with inline fixes and undo | ✅ | `lib/resume/lint.ts` |
| Tailoring: plan schema, guards, render, compile, fit-to-page, ATS report, reuse | ✅ | `lib/resume/plan.ts`, `lib/resume/tailor.ts`, `lib/resume/ats-check.ts` |
| LLM layer: Claude Code (Pro) + manual + cache + daily cap + fallback | ✅ | `lib/llm/provider.ts` |
| Autofill: persistent Playwright browser, extraction, resolver chain, adapters (Greenhouse, Lever, Ashby, Workable, generic), multi-step, AI drafts, review, submit, confirmation, learning | ✅ | `lib/apply/` |
| Sessions, state machine, events, screenshots, live stream (SSE) | ✅ | `lib/apply/sessions.ts`, `app/api/apply/[sid]/stream` |
| UI: responsive shell, Jobs (split view), Apply (Studio + Review), Applications board | ✅ | `app/jobs`, `app/apply/[sid]`, `app/tracker`, `components/career/` |
| Settings: Setup & health (one-click installs), Job preferences, Resume (bases/issues/facts/skills/output), Application answers + learned, AI, Apply automation | ✅ | `app/settings/*` |
| Tests: 101 unit, 15 integration (browser + full stack), 1 opt-in live Claude test | ✅ | `tests/` |

**Changes from the design above**

- **PDF preview** uses the browser's built-in viewer (an iframe of an authenticated blob) instead of pdf.js. Phones get an "Open PDF" button.
- **Stricter guard:** a rewritten bullet may only name technologies from *that bullet* or its entry's stack. Using anything from the whole skills list could make one job claim a technology used elsewhere.
- **Policy answers** live in the settings store (`apply_answers`), not a table. Applications and the stage live on the session row.
- **Background JD rendering** uses its own short-lived headless browser. It never uses the visible automation profile, so nothing pops up on your screen.

**Not built yet / not verified here**

- The `anthropic-api` provider is not built. Selecting it falls back to manual mode.
- The extension executor upgrade (phase 6) is not built. There is no Workday-specific account-creation adapter: Workday forms go through the generic adapter, using the persistent signed-in profile.
- The light theme is not built.
- **pdfLaTeX was not installed on the dev machine.** Real compiles, page counts and the full ATS check on a real PDF were therefore not exercised. Log parsing, the "compiler missing" paths and everything before compile are tested. Install MiKTeX from Settings → Setup & health and compile your base once to verify.
- **Postgres** was not exercised in this run (all tests used SQLite). The SQL is written for both.

---

## 1. Goals and principles

**What you get**
1. See **every** job from every company you add, with the full job description and a relevance score.
2. Click **Apply**. The app opens a per-job **Resume Studio** with your base LaTeX resume already loaded.
3. Click **Generate** to get an ATS-friendly, job-tailored LaTeX resume. Edit it freely and see the compiled PDF live.
4. Approve the resume. The app **autofills the application** in a real browser, uploads that PDF and answers the questions.
5. You review every field, then submit. Everything is recorded: job description snapshot, exact resume, every answer, screenshots, timeline.

**Principles**

| # | Principle | Why |
|---|---|---|
| P1 | **AI drafts, code verifies, you approve.** Nothing is submitted without your click. | Tools that submit unattended (LazyApply, AIHawk) get ignored or flagged and invent experience |
| P2 | **No invented claims.** The AI can only select and rephrase facts from your fact bank. Numbers and skills are checked mechanically. | One fake metric can cost you an interview |
| P3 | **Your template is preserved.** The AI never touches the preamble or layout, only content. | Compiling stays reliable and the design never drifts |
| P4 | **Learn once, reuse forever.** Every answer you correct goes into the answer bank. | The second application to a similar form is close to zero-touch |
| P5 | **Everything is an event.** Each state change is a database row. | Full audit trail, retries, analytics |
| P6 | **It degrades gracefully.** If AI, compiler or browser automation fails, there's a manual path. | Nothing blocks you from applying |

What we took from existing products:

| Product | What we take |
|---|---|
| Simplify Copilot | Autofill in a real browser with a human submitting, and per-ATS adapters |
| Teal / Rezi | Master resume (fact bank) and per-job versions |
| Jobscan | Keyword coverage report and ATS parse check |
| Overleaf | Split LaTeX editor with live PDF preview |
| Huntr | JD snapshot and the exact resume stored per application |

---

## 2. Deployment mode (decision)

**Run everything on your laptop (Windows) for this flow.** All three heavy pieces need your machine:

| Piece | Needs |
|---|---|
| Claude (via your **Pro** plan) | The Claude Code CLI logged in as you |
| pdfLaTeX | A local TeX distribution (MiKTeX) |
| Browser automation | A visible Chromium window you can watch and step into, with a **persistent profile** so Workday/iCIMS logins survive between runs |

Server mode (Oracle VM + phone) is supported by the same code later. On the server the browser runs headless and you review on your phone through streamed screenshots. It needs Claude Code and TeX Live installed there. This doesn't change the design, only configuration (`AUTO_APPLY_MODE=local|server`).

### Processes

```
┌──────────────────────── your laptop ─────────────────────────────────────────┐
│                                                                              │
│  web  (next start :8787)            worker  (node worker/index.ts)           │
│  ├─ UI (jobs, studio, review)       ├─ task runner (polls `tasks` table)     │
│  ├─ REST API                        ├─ scanner + JD fetcher                  │
│  └─ SSE: proxies worker events  ◀──▶├─ resume: parse · tailor · compile · ATS│
│        (127.0.0.1:8788, token)      ├─ apply: Playwright executor (headed)   │
│                                     └─ llm: claude-code CLI provider         │
│                    ┌──────────────────────┐                                  │
│                    │ DB (SQLite or Neon PG)│  data/ (tex, pdf, screenshots)  │
│                    └──────────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Why a separate worker:** Playwright, pdflatex and Claude calls are slow and can crash. They must never freeze or crash the UI.
- **web → worker:** durable work goes through the DB `tasks` table (survives restarts). Live interactive calls (apply edits to the open form, submit) go through the worker's control API, bound to `127.0.0.1` and protected by a shared token.
- **worker → web:** an event stream (SSE) that the web process relays to the browser.
- **The task queue is a DB table**, not Redis or pg-boss. It works on both SQLite and Postgres, which the app already supports. The worker claims tasks with an atomic `UPDATE … WHERE status='queued'`.
- `start.ps1` starts both processes. The existing Telegram listener stays in the web process for now and moves to the worker in a later phase.
- Required tools (MiKTeX, Playwright Chromium, poppler, Claude Code) are **detected and installed from Settings → Setup & health** (§10.2). Nothing has to be set up by hand outside the app except the Claude Code login.

---

## 3. End-to-end flow

```
[Jobs]──click──▶[Job detail]──Apply──▶ apply_session created
                                          │
        ┌─────────────────────────────────┘
        ▼
 ① RESUME STUDIO ── Generate ─▶ tailor task ─▶ plan(LLM) ─▶ render ─▶ guards ─▶ compile ─▶ fit-to-page ─▶ ATS check
        │  edit LaTeX ⇄ recompile (live PDF)                                                       │
        │◀──────────────────────────────────────────── version shown with report ◀─────────────────┘
        │  "Use this resume" → version LOCKED
        ▼
 ② AUTOFILL ── worker opens apply URL in Chromium ─▶ detect ATS ─▶ extract form ─▶ resolve answers ─▶ fill + upload PDF
        │                                                                                     │
        ▼                                                                                     ▼
 ③ REVIEW  ◀── fill plan + screenshot + flags (needs you / AI-drafted / low confidence) ◀───────┘
        │  edit answers (applied to the live page; saved to answer bank)
        │  CAPTCHA? → you solve it in the visible window
        ▼
 ④ SUBMIT ── click real submit ─▶ detect confirmation ─▶ screenshot
        ▼
 ⑤ TRACKED ── job.state=applied · application stage=applied · full timeline
```

### Apply session state machine

```
created ─▶ resume_drafting ─▶ resume_ready(locked) ─▶ filling ─┬─▶ reviewing ─▶ submitting ─┬─▶ submitted
                 ▲  │                                            ├─▶ needs_input ─(answer)──▶ reviewing
                 └──┘ (regenerate/edit)                          ├─▶ blocked (captcha/login)─(you resolve)─▶ filling
                                                                 └─▶ failed ─(retry)─▶ filling
                                                     submitting ─▶ unconfirmed ─(you: yes/no)─▶ submitted | reviewing
any state ─▶ cancelled
```

After `submitted`, the **application stage** is tracked separately: `applied → screening → interview → offer | rejected | ghosted`. It's marked `ghosted` automatically after 30 days with no update, and you can change it manually.

---

## 4. Jobs: discovery, description, scoring

### 4.1 Store every job

The current scanner keeps title and URL and only flags matches. It changes to store every job, with these new columns: `description_html`, `description_text`, `posted_at`, `ats_type`, `ats_job_id`, `apply_url`, `match_score`, `match_breakdown`, `jd_fetched_at`. The Jobs page has an **All / Relevant (≥ threshold)** toggle.

### 4.2 Job description fetch per ATS

| ATS | List endpoint (exists) | Description source |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{t}/jobs` | Same call with `?content=true` (one request for all JDs) |
| Lever | `api.lever.co/v0/postings/{t}?mode=json` | `descriptionPlain` + `lists[]` in the same payload |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{t}` | `?includeCompensation=true`; `descriptionHtml` in the payload |
| Workable | widget API | `GET /api/v1/widget/accounts/{t}/jobs/{shortcode}` (or job page) |
| SmartRecruiters | `/v1/companies/{t}/postings` | `/v1/companies/{t}/postings/{id}` → `jobAd.sections` |
| Recruitee | `/api/offers/` | `description` + `requirements` in the payload |
| **Workday (new)** | `POST {host}/wday/cxs/{tenant}/{site}/jobs` (paged, 20/page) | `GET …/job/{externalPath}` → `jobPostingInfo.jobDescription` |
| Other / JS sites | Playwright render → existing link heuristics | Playwright render of the job page + readability extraction |

**Rules:**
- The JD is fetched **once** per new job, in a `jd_fetch` task, with at most 3 concurrent fetches and 1 request/second per host.
- HTML is sanitized (allowlisted tags only) before storage. Plain text is derived for scoring.
- Clicking Apply re-fetches the JD if it's older than 7 days, so the snapshot sent with the application is current.

**ATS auto-detect** runs when a company is added, using URL patterns plus page HTML markers (`grnhse_app`, `jobs.lever.co` iframes, `myworkdayjobs.com`, `icims.com`, `ashby_embed`). It fills `ats_type` and `ats_token` and shows "Detected: Greenhouse ✓".

### 4.3 Relevance score (deterministic, explainable)

`score = 35·title + 30·skills + 15·experience + 10·location + 5·freshness + 5·company_priority`, with each component between 0 and 1.

| Component | Rule |
|---|---|
| title | Max similarity of the job title to your **target roles** plus a synonym table: SDE ↔ Software Engineer ↔ Software Developer; Backend ↔ Server-side; ML Engineer ↔ AI Engineer; Full Stack |
| skills | Share of JD skills (from a skill dictionary with aliases: `js↔javascript`, `k8s↔kubernetes`, `gcp↔google cloud`) that are in your **skills inventory**, weighted by "required" vs "preferred" sections |
| experience | The JD's year range (e.g. "0–2 years", "new grad", "3+ years") against your experience (≈ 0.7 years) |
| location | Preferred locations, remote, relocation flag |
| freshness | 1.0 if ≤ 3 days old, decaying linearly to 0 at 45 days |
| company_priority | The priority you set per company (high/normal/low) |

**Hard filters** set the score to 0 with a visible reason: excluded keywords (e.g. "Senior", "Staff", "10+ years"), excluded locations, and "already applied". The default threshold for Relevant is 55. The breakdown is shown on every job card, for example: `78 · title ✓ · 9/12 skills · exp fits (0–2y) · Bengaluru ✓ · 2d old`.

---

## 5. Resume Studio

### 5.1 Your base resume, analysed

I reviewed your `main.tex`. The template uses a small, consistent set of macros, so it can be **parsed deterministically** without AI:

| Macro | Meaning (argument order) |
|---|---|
| `\section{\textbf{X}}` / `\section*{…}` | Section boundary: Professional Summary, Technical Skills, Education, Work Experience, Projects, Certifications, Achievements |
| `\resumeSubheading{#1 title}{#2 location}{#3 organisation}{#4 dates}` | Experience and education entry |
| `\resumeProject{#1 name ∣ type ∣ link}{#2 tech stack}{#3 year}{#4}` | Project entry |
| `\item {…}` between `\resumeItemListStart` and `\resumeItemListEnd` | Bullet |
| `\textbf{Category}{: a, b, c}` inside Technical Skills | Skill groups |
| Header `tabularx` block + `\newcommand{\name}`, `\phone`, `\emaila` | Contact block (kept verbatim) |

From this the app builds:
- the **template**: the preamble plus the header, with marked slots for each section;
- the **fact bank**: structured JSON with a stable ID for every entry and bullet.

Rendering the fact bank back into the template reproduces your file. A round-trip test checks this: the PDF text from parse → render must equal the PDF text of the original.

**Issues in the base.** The app's base-resume linter (§10.4) **detects these automatically** and lists them under **Settings → Resume → Issues**, each with an inline fix. ⛔ items block sending until they're resolved.

| # | Finding | How you resolve it in Settings |
|---|---|---|
| 1 | ⛔ Unresolved `TODO`s: graduation month/year, CGPA, project comments ("insert dataset size", "verify against repo") | Inline fields: graduation month/year picker, CGPA (or "Don't list"), and one text box per project TODO. Answers are written into the fact bank and the base. The app also **blocks** any resume whose PDF text contains `TODO`. |
| 2 | ⛔ "working knowledge of C# and .NET fundamentals": your own note says keep it only if true | Buttons: **"I confirm this is true"** or **"Remove"**. If removed, it leaves the fact bank, and the AI can never add it back. |
| 3 | ⚠ The Periodontitis project links to `github.com/sashankbanda/...` but says "Individual" | The linter compares link owners with your Profile GitHub username. Choose **Individual / Team** and optionally a replacement link. |
| 4 | ⚠ No `\input{glyphtounicode}` / `\pdfgentounicode=1` | Added to the template preamble, so ATS text extraction maps ligatures ("fi", "ffi") correctly: "certified" is not read as "certi ed" |
| 5 | ⚠ The header is a 2-column table, so some ATS read "ALEX MORGAN Ph: +91-…" as one line | The ATS check verifies the extracted name, email and phone. A single-column header is offered as an option if a parse fails. |
| 6 | ⚠ No city in the header | One-click fix that adds the city from Profile → Current location. Many ATS filter candidates by location. |
| 7 | ⚠ The forced `\newpage` before Projects | Removed in generated versions. The fit-to-page step (§5.3) decides the length, using **Max pages** from Settings → Resume → Output (1 or 2, default 2). |
| 8 | ℹ Empty-text links `\href{…}{\textcolor{blue}{}}` next to two job titles | Invisible and useless to an ATS. Turned into a visible "Certificate" link, or removed. |
| 9 | ℹ The file header says it's tuned for one Microsoft job | The base becomes **neutral (master)**. Tailoring happens per job. |
| 10 | ℹ Unused packages and macros (`tcolorbox`, `\cvsection`, `\resumePOR`, `marvosym`, `multicol`, `graphicx`) | Kept for now since they're harmless. Optional cleanup speeds up compiling. |

### 5.2 Fact bank (single source of truth)

```jsonc
{
  "contact": { "name": "ALEX MORGAN", "phone": "+91-9000000000", "email": "you@example.com",
               "github": "...", "linkedin": "...", "location": "Chennai, India" },
  "summary_facts": ["backend services", "REST APIs", "Azure/AWS/OCI", "..."],
  "skills": { "Languages": ["Java","Python","SQL","JavaScript"], "Backend & APIs": [...], ... },
  "skills_inventory_extra": [],          // TRUE skills not printed today; the AI may add these
  "experience": [
    { "id": "exp_beetloop_fte", "title": "Full Stack & AI/ML Developer", "org": "BeetLoop Global Solutions Pvt Ltd",
      "location": "Chennai", "dates": "Apr 2026 -- Present", "locked": true,
      "bullets": [ { "id": "b1", "text": "Design, implement, test, and maintain backend features ...",
                     "metrics": [], "skills": ["Java","Spring Boot","REST","unit testing","code review"] }, ... ] }
  ],
  "projects": [ { "id": "prj_course_builder", "name": "AI Course Builder", "stack": [...], "year": "2026",
                  "link": "...", "bullets": [...] } ],
  "education": [...], "certifications": [...], "achievements": [...]
}
```

- `metrics` (e.g. `50%`, `0.92`, `500+`, `100,000+`) and `skills` are extracted for each bullet automatically, and you can edit them. The guards check against these.
- You can add **extra bullets that don't fit on the page** to the fact bank. The more facts, the better the tailoring.
- `skills_inventory_extra` is edited in **Settings → Resume → Skills inventory**. Adding a skill there means "I confirm I have this", and only then may the AI print it.
- The fact bank is versioned. Editing the base LaTeX re-parses it, and you confirm the diff.

### 5.3 Tailoring pipeline

```
JD text ──▶ (1) JD analysis ──▶ (2) LLM plan ──▶ (3) render ──▶ (4) guards ──▶ (5) compile ──▶ (6) fit-to-page ──▶ (7) ATS check
            deterministic        Claude (JSON)     deterministic   deterministic   pdflatex       deterministic loop    deterministic
```

1. **JD analysis:** skill-dictionary matches, split into required and preferred by section headings ("Requirements", "Qualifications", "Nice to have"), plus the top n-grams. Output: `{required[], preferred[], keywords[], seniority}`.
2. **LLM plan:** Claude receives the fact bank, the JD analysis, the raw JD (marked as untrusted data) and the rules. It returns **only** JSON matching this schema:

   ```jsonc
   {
     "summary": { "text": "...", "fact_refs": ["exp_beetloop_fte.b1", "prj_course_builder.b2"] },
     "skills": { "order": ["Backend & APIs", "Languages", ...],
                 "items": { "Languages": ["Java","Python",...] } },        // only from skills + inventory_extra
     "experience": [ { "id": "exp_beetloop_fte",
                       "bullets": [ { "ref": "b2", "text": "rephrased ..." }, { "ref": "b1" } ] } ],  // all entries kept, ≥2 bullets each
     "projects": [ { "id": "prj_course_builder", "bullets": [ ... ] } ],    // choose 2–4, ordered by relevance
     "certifications": ["az_ai_900", "oci_ds"],                             // select/order
     "notes_for_user": ["JD asks for Kafka — not in your fact bank; add it if true."]
   }
   ```

   Prompt rules: rephrase to surface JD terms **only where the source bullet supports them**; keep every number exactly as written; never add employers, titles, dates, metrics or skills; keep bullets ≤ 230 characters; use action verbs and past tense for past roles.
3. **Render:** the plan is applied to the template. All text is LaTeX-escaped (`& % $ # _ { } ~ ^ \`) on insert, so the AI's output can never inject LaTeX commands.
4. **Guards** (each result is shown in the UI):
   - **Metrics:** every number or percentage in a bullet must exist in that bullet's source `metrics`. Otherwise ⛔ *reject the bullet* and fall back to the original text.
   - **Skills:** every technology named must be in skills ∪ inventory_extra ∪ the source bullet. Otherwise ⛔ remove it.
   - **Entity lock:** employers, titles, dates and education are copied from the fact bank, never from the AI.
   - **Coverage:** every `ref` must exist, and no experience entry can be dropped.
   - **Drift score:** how much each rewritten bullet differs from its source. A rewrite more than 60% different is flagged ⚠ for your review.
5. **Compile:** `latexmk -pdf -interaction=nonstopmode -halt-on-error -no-shell-escape` in an isolated temp directory, with a 60 s timeout and `openin_any=p` / `openout_any=p`. Errors in the log are mapped to editor line numbers.
6. **Fit-to-page:** `pdfinfo` gives the page count. While it's above the maximum, the lowest-relevance optional bullet is dropped (projects first, then older experience beyond 2 bullets) and the resume is recompiled, up to 6 times. Layout stays untouched.
7. **ATS check:** `pdftotext` (raw + layout) on the PDF:
   - name, email and phone are found in the first 400 characters;
   - standard headings are present;
   - no `TODO`, no `\` artifacts, no replacement characters (`�`);
   - the text order of each section is preserved;
   - file is under 1 MB;
   - **keyword coverage** of required and preferred skills is reported before and after tailoring, with a list of "missing but true?" skills you can add to the inventory with one click.
   - The file is saved as `Alex_Morgan_Resume.pdf`, with no company name, since recruiters can see filenames.

**Typical timing:** plan 20–60 s (Claude), render + compile + fit 3–10 s. The UI streams the progress of each step.

### 5.4 Studio UI

| Laptop (≥ 1024 px) | Mobile |
|---|---|
| Three panes: **LaTeX editor** (CodeMirror 6, `stex` mode, error gutter) · **PDF preview** (pdf.js canvas) · **report** (ATS score, coverage, guard flags, diff vs base) | Tabs: Edit · Preview · Report. Sticky action bar. |

**Actions:** Generate · Regenerate (with a hint, e.g. "emphasize backend more") · Compile (also Ctrl+S) · Diff vs base / vs previous · Revert · **Use this resume →**

- **Manual edits are first-class.** If you edit the LaTeX directly, that version is saved as `generated_by=user`, and the guards and ATS check still run on it as warnings, not blocks. Only `TODO` and failed compiles block.
- **Reuse:** before generating, the app finds earlier locked versions for similar JDs (cosine similarity ≥ 0.85 on JD keywords) and offers "Start from the version used for X".

### 5.5 LLM provider layer (Claude Pro)

```ts
interface LlmProvider {
  id: 'claude-code' | 'manual' | 'anthropic-api'
  status(): Promise<{ ok: boolean; detail: string }>
  generateJson<T>(req: { system: string; prompt: string; schema: object; timeoutMs?: number }): Promise<T>
}
```

| Provider | Mechanism |
|---|---|
| **claude-code** (default) | `claude -p --output-format json --json-schema <schema> --tools "" --system-prompt <sys> --no-session-persistence`, with the prompt on stdin. Uses your **Pro login**. Never `--bare`, which skips OAuth. The app never reads your token. The model is whatever your Claude Code default is, and can be overridden in Settings → AI. |
| manual | The app shows the prompt with a **Copy** button. You paste the answer from claude.ai back in, and the same schema validation and guards run. |
| anthropic-api | Optional later, with an API key |

**Operating rules:**
- One call at a time, 180 s timeout.
- Output that fails schema validation gets one retry with the error added.
- "Usage limit reached" or a CLI that isn't installed or logged in → automatic switch to **manual** with a banner.
- Results are cached by `sha256(prompt + schema + facts_version)`.
- **Security:** tools are disabled, so a prompt injection inside a JD can't do anything. Output is plain data that still has to pass the schema and the guards.
- **Budget:** about 1 call per resume plus 0–1 per form, which is comfortable within Pro limits. Settings → AI shows status, a Test button and calls made today.

---

## 6. Autofill engine

### 6.1 Executor: Playwright with a persistent, visible browser

- `chromium.launchPersistentContext('data/browser-profile', { headless: false })` in local mode.
  - **You can watch it fill, type into it, and solve CAPTCHAs in the same window.**
  - **Logins persist** in the dedicated profile: sign into Workday/iCIMS/Taleo candidate accounts once, and later runs reuse them.
  - It's a separate profile from your everyday Chrome.
- Server mode: the same code headless, with a screenshot after every step streamed to the review screen. CAPTCHA or login pages → `blocked` with "finish on laptop".
- **No stealth or fingerprint evasion.** Normal typing speed with small delays. If a site rejects automation, it falls back to manual with the plan shown as copy-paste.
- The browser stays open for **20 minutes** while you review, then closes. Replaying the plan is deterministic, so a re-fill is cheap.
- *Later, optional:* the existing Chrome extension upgraded to run the same fill plan in your everyday browser.

### 6.2 Pipeline

```
open apply_url ─▶ detect ATS ─▶ (multi-step loop) ─▶ extract fields ─▶ resolve ─▶ fill ─▶ read back & verify ─▶ next page ─┐
                                      ▲────────────────────────────────────────────────────────────────────────────────┘
                                   stop before the final submit → REVIEW
```

**ATS adapters** (`lib/apply/ats/*.ts`), each implementing:

```ts
interface AtsAdapter {
  matches(url: string, html: string): boolean
  open(page, job): Promise<void>                 // e.g. click "Apply" to reveal form
  extract(page): Promise<FormField[]>            // fields of current step
  fill(page, field, value): Promise<void>        // type/select/upload/check
  next(page): Promise<'next' | 'final'>          // multi-step navigation
  submit(page): Promise<void>
  confirmation(page): Promise<boolean>           // thank-you detection
}
```

| Adapter | Notes | Priority |
|---|---|---|
| Greenhouse (`job-boards.greenhouse.io`, embedded `grnhse_iframe`) | `#first_name #last_name #email #phone`, resume `input[type=file]`, `#question_*`, React-select dropdowns, EEO block | P1 |
| Lever (`jobs.lever.co/.../apply`) | `name`, `email`, `phone`, `org`, `urls[LinkedIn]`, resume upload, `cards[...]` custom questions, EEO | P1 |
| Ashby (`jobs.ashbyhq.com/.../application`) | `_systemfield_name/email/resume`, custom questions, some boards use resume auto-parse (wait for it to settle, then overwrite) | P1 |
| Workable, SmartRecruiters | Single-page forms, standard fields | P2 |
| Workday | Account login/sign-up, 5–7 steps (My Information → Experience → Questions → Voluntary Disclosures → Review). It parses the uploaded resume, then the adapter corrects the fields. | P2 |
| Generic | Accessibility-tree walk: `<label for>`, `aria-label(ledby)`, placeholder and nearby text; supports text, textarea, select, combobox, radio, checkbox, date, file | P1 (fallback) |

**Uploading the resume:** `setInputFiles` with the locked version's PDF. If the ATS then parses it and auto-fills fields, the adapter waits for the parse to settle and overwrites with the plan's values.

### 6.3 Answer resolution chain

Each field gets `{value, source, confidence}`. The first resolver that's confident wins.

| # | Resolver | Example | Confidence |
|---|---|---|---|
| 1 | **Learned mapping**: (ats_type, field signature) → profile key, from your past corrections | Greenhouse `question_8812` "LinkedIn Profile" → `linkedin` | high |
| 2 | **Profile rules**: one shared module unifying `extension/rules.js` and `gform.ts` | "Notice period" → `notice_period` | high |
| 3 | **Answer bank**: normalized question, exact match, then fuzzy (token-set ratio ≥ 0.9) | "Are you legally authorized to work in India?" → "Yes" | high / medium |
| 4 | **Option matcher** for select, radio and combobox: normalize, synonyms, numeric ranges | "B.Tech" ↔ "Bachelor's degree"; "0–1 years" bucket | medium |
| 5 | **Application answers** you set once in Settings (§10.5) | Work authorization, notice period, CTC, start date, relocation, EEO → your saved choice (EEO default "Decline to self-identify") | high |
| 6 | **Generated answers**: open questions ("Why X?", "Tell us about a project") from JD + locked resume + facts, ≤ the field's character limit | — | always flagged ✍ |
| 7 | **Unknown** | — | ❗ needs you |

**Hard rules:**
- **Never auto-answer** legal attestations ("I certify…") or background-check consent. They always need your explicit tick, and this isn't configurable. Salary fields are filled only from Application answers.
- Sponsorship and work authorization come only from Application answers. They are never generated.
- A ❗ field answered during review has a **"Save to Application answers"** option, so it becomes a setting and isn't just a learned answer.
- The field's maximum length, required flag and type are respected. Values are read back after filling, and a mismatch is flagged.

**Learning:** when you change or answer a field during review, the app writes back to `answer_bank` (question → answer) and to `field_mappings` (signature → key). A metric on the dashboard tracks the share of fields filled without you over time.

### 6.4 Review screen

```
┌─ Review · Software Engineer @ Acme (Greenhouse) ───────── step 2/2 ─────┐
│ [ live screenshot / visible browser window ]                             │
│ Resume: Alex_Morgan_Resume.pdf (v3, locked) ✓ uploaded                 │
│ ✅ 16 profile   🧠 4 answer bank   ✍ 1 drafted — edit   ❗ 1 needs you      │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ ❗ Earliest start date        [ ________ ]                            │ │
│ │ ✍ Why do you want to join?   "I've been building REST services…" ✎  │ │
│ │ 🧠 Authorized to work in IN? Yes  (answer bank, used 7×)              │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ ⚠ Already applied to Acme 12 days ago (different role)                   │
│                                [ Cancel ]  [ Save & stop ]  [ Submit ▶ ] │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Submit** is disabled while any ❗ remains.
- After submitting, the app detects confirmation through success-text patterns, a URL change, or the form disappearing. It takes a final screenshot and moves to `submitted`. If it can't tell, it moves to `unconfirmed` and asks "Did it go through?"

### 6.5 Guardrails

| Guard | Default |
|---|---|
| One live session per company domain | on |
| Daily submit cap | 20 |
| Duplicate warning: same job URL, or same company within 14 days | warn (same job = block) |
| Session timeout | 20 min |
| Navigation allowlist: the job's domain plus known ATS/SSO domains; downloads disabled | on |

---

## 7. Data model

Migrations are a numbered SQL runner (`schema_migrations` table) in the existing DB layer. They work on both SQLite and Postgres, and JSON is stored as TEXT, as now.

```sql
-- 001: extend existing tables
ALTER TABLE companies   ADD ats_type TEXT, ADD ats_token TEXT, ADD priority TEXT DEFAULT 'normal';
ALTER TABLE company_jobs ADD description_html TEXT, ADD description_text TEXT, ADD posted_at TEXT,
                         ADD ats_job_id TEXT, ADD apply_url TEXT, ADD match_score INTEGER,
                         ADD match_breakdown TEXT, ADD jd_fetched_at TEXT, ADD jd_hash TEXT;

-- 002: resume
resume_bases     (id, name, latex, template_json, is_default, created_at, updated_at)
fact_banks       (id, base_id, version, data_json, created_at)
resume_versions  (id, base_id, fact_bank_id, parent_id, job_id, session_id, latex, pdf_path,
                  page_count, ats_report_json, guard_report_json, llm_plan_json,
                  generated_by /*llm|user|base*/, status /*draft|locked*/, created_at)

-- 003: apply
apply_sessions   (id, job_id, resume_version_id, status, ats_type, apply_url, executor /*local|server*/,
                  form_json, fill_plan_json, jd_snapshot_text, error, attempts,
                  started_at, submitted_at, updated_at)
application_events (id, session_id, type, actor /*user|system*/, data_json, at)
applications_stage (session_id PK, stage, stage_updated_at, notes)
artifacts        (id, session_id, kind /*screenshot|pdf|html*/, path, step, at)

-- 004: learning
answer_bank      (id, question_norm, question_raw, answer, field_type, options_sig, ats_type,
                  uses, last_used_at, created_at)
field_mappings   (id, ats_type, field_sig, label_norm, profile_key, uses, last_used_at)
-- (Application answers, Job preferences, Resume output, AI and Apply automation are
--  configuration, so they live in the settings store: see §10.7. Not tables.)

-- 005: infra
tasks            (id, type, payload_json, status /*queued|running|done|failed*/, run_after, attempts,
                  locked_by, locked_at, last_error, created_at)   -- idx(status, run_after)
llm_calls        (id, provider, purpose, input_hash, ok, duration_ms, error, at)
```

**Files** (under `data/`, gitignored):

```
data/resumes/versions/{vid}/main.tex · main.pdf · build.log
data/apply/{sid}/step-{n}.png · final.png · form.html
data/browser-profile/            (Playwright persistent profile)
```

---

## 8. API surface (web)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/jobs?state&min_score&company&q&sort&page` | List all jobs |
| GET | `/api/jobs/:id` | Detail: JD, score breakdown, history |
| POST | `/api/jobs/:id/refresh` | Re-fetch the JD |
| PATCH | `/api/jobs/:id` | Change state (new, shortlisted, dismissed) |
| POST | `/api/jobs/:id/apply` | Create an apply session → `{session_id}` |
| GET | `/api/apply/:sid` | Session + current resume version + plan |
| GET | `/api/apply/:sid/stream` | **SSE**: progress, screenshots, state changes |
| POST | `/api/apply/:sid/resume/generate` `{hint?}` | Queue a tailor task |
| PUT | `/api/resume/versions/:vid` `{latex}` | Save a manual edit (creates a child version) |
| POST | `/api/resume/versions/:vid/compile` | Compile + ATS check |
| GET | `/api/resume/versions/:vid/pdf` | PDF bytes |
| POST | `/api/apply/:sid/resume/lock` `{vid}` | Use this resume |
| POST | `/api/apply/:sid/fill` | Start the executor |
| PATCH | `/api/apply/:sid/answers` `{field_id: value}` | Apply to the live page + learn |
| POST | `/api/apply/:sid/submit` | Click the real submit |
| POST | `/api/apply/:sid/confirm` `{submitted}` | Resolve `unconfirmed` |
| POST | `/api/apply/:sid/cancel` | Cancel the session |
| PATCH | `/api/apply/:sid/stage` | screening / interview / offer / rejected |
| GET/PUT | `/api/resume/bases[/:id]`, `/api/resume/facts` | Base LaTeX (multiple, one default) + fact bank |
| GET | `/api/resume/issues` | Base-resume linter results |
| POST | `/api/resume/issues/:id/resolve` `{action, value}` | Resolve an issue (writes base + fact bank) |
| CRUD | `/api/answers` | Learned answer bank |
| GET/PUT | `/api/settings` (existing) | New sections: `job_prefs`, `apply_answers`, `resume_prefs`, `ai`, `apply_automation` |
| GET | `/api/setup/status` | All readiness checks (§10.2) |
| POST | `/api/setup/install/:tool` | Run a **whitelisted** installer (streams its log) |
| GET/POST | `/api/llm/status`, `/api/llm/test` | Provider health |
| POST | `/api/browser/open-profile` | Open the automation browser so you can sign in to ATS accounts |
| GET | `/api/jobs/preview-count?…prefs` | Live "N of M jobs relevant" while you edit preferences |

The worker's control API (`127.0.0.1:8788`, `X-Worker-Token`) mirrors `fill`, `answers`, `submit` and `cancel` for live sessions, and exposes `/events` for SSE. It is never exposed publicly.

---

## 9. UI and pages

| Page | Laptop | Mobile |
|---|---|---|
| **Jobs** | Sidebar nav · filter bar · table (score, title, company, location, posted, state) · **split view** detail pane | Card list · filter sheet · swipe to shortlist/dismiss |
| **Job detail** | JD (sanitized) · score breakdown · keywords have/missing · history · **Apply** | Full-screen, sticky Apply button |
| **Apply** (stepper: Resume → Fill → Review → Done) | Studio panes, then review panel next to the live browser | Tabs + bottom action bar |
| **Applications** | Kanban by stage · timeline per application (events + screenshots + resume link) | Segmented list by stage |
| **Settings** | Full design in §10 | Same pages, single column |

**Layout:**
- **Breakpoints:** < 768 px bottom tabs; 768–1023 px icon rail; ≥ 1024 px full sidebar. The current `.shell { max-width: 560px }` becomes a fluid container (max 1440 px) with page-level grids.
- **Styling:** the existing dark theme tokens are kept and a light theme is added. Accessible focus states, skeleton loaders, optimistic updates.
- **Keyboard (laptop):** `j/k` navigate · `a` apply · `s` shortlist · `d` dismiss · `Ctrl+S` compile.

---

## 10. Settings and setup

**Rule:** everything the flow needs from you is entered, checked and changed **inside the app**. There are no config files and nothing to send to a developer. Every page works on laptop and phone, and autosaves through the existing atomic settings writer.

### 10.1 Settings map

```
Settings
├─ Setup & health            (new)  readiness checklist, tool install, worker status
├─ Profile                   (existing) identity, contact, links, education, current role
├─ Job preferences           (new)  target roles, locations, seniority, filters, threshold
├─ Companies                 (existing) + priority, ATS detected, scan interval
├─ Resume                    (new, replaces "Resumes" for this flow)
│   ├─ Base resumes          upload/paste/edit .tex, compile preview, default
│   ├─ Issues                linter findings with inline fixes
│   ├─ Fact bank             entries, bullets, metrics/skills tags, extra bullets
│   ├─ Skills inventory      true skills not printed on the base
│   └─ Output                max pages, filename, tailoring style
├─ Application answers       (new)  work authorization, notice, CTC, start date, relocation, EEO, common Qs
│   └─ Learned answers       answer bank: search, edit, delete
├─ AI                        (new)  provider, status, test, model, limits
├─ Apply automation          (new, extends "Automation") browser, caps, timeouts, ATS sign-ins
├─ Email sending · Email template · Telegram · Security   (existing, unchanged)
└─ PDF resumes (existing "Resumes" page, still used by email/Telegram applies)
```

### 10.2 Setup & health (first-run wizard + permanent checklist)

The first launch opens this as a **step-by-step wizard**. Afterwards it's a checklist page. A banner shows on Jobs and Apply while any blocking item is red.

| Check | How it's detected | Fix offered in the app | Blocks |
|---|---|---|---|
| Worker running | Heartbeat row every 10 s | "Restart worker" | everything below |
| Profile complete | Name, email, phone, location, links present | Link to Profile | Fill |
| Job preferences set | ≥ 1 target role | Link to Job preferences | Relevant filter (All still works) |
| Base resume uploaded | ≥ 1 base marked default | Upload / paste | Generate |
| Base resume issues | 0 ⛔ issues from the linter | Link to Resume → Issues (count shown) | Generate, Submit |
| **MiKTeX** (pdflatex + latexmk) | `pdflatex --version`, `latexmk -v` on PATH / MiKTeX dirs | **Install** → `winget install --id MiKTeX.MiKTeX -e`, then sets on-the-fly package install (`initexmf --set-config-value [MPM]AutoInstall=1`), then test-compiles your base | Compile |
| poppler (pdftotext, pdfinfo) | `pdftotext -v` | **Install** → `winget install --id oschwartz10612.Poppler -e` (or bundled copy) | ATS check |
| **Playwright Chromium** | `playwright` package + browser in cache | **Install** → `npx playwright install chromium` | Fill |
| Claude Code installed | `claude --version` | Shows the install command and a link | Generate (Manual still works) |
| Claude Code logged in | `/api/llm/test`: a tiny JSON call | Instructions: "Open a terminal → run `claude` → `/login` with your Pro account → **Recheck**". OAuth can't be done from inside the app. | Generate (Manual still works) |
| Application answers (minimum) | Work authorization + notice period + relocation set | Link to Application answers | Fill (others become ❗ at review) |
| ATS sign-ins (optional) | — | **Open automation browser** to sign in to Workday/iCIMS once | — |

**Installer safety:**
- Only the fixed commands above can run. No user-supplied strings are executed.
- Each one needs a confirmation click and streams its log live.
- Each runs in the worker, as your user, with no elevation unless the installer itself asks for it.
- After installing, the check reruns automatically.

**Readiness gating everywhere:** a disabled button always says why and links to the fix, for example *"Generate unavailable — 2 resume issues to resolve → Fix"*.

### 10.3 Job preferences

| Field | Control | Used by |
|---|---|---|
| Target roles | Chips, with a synonym preview ("Software Engineer → also matches SDE, Software Developer") | Score: title |
| Seniority levels | Multi-select: Intern · New grad · 0–2 y · 2–5 y | Score: experience, hard filter |
| Experience (years) | Auto-computed from fact-bank dates (≈ 0.7 y), overridable | Score: experience |
| Preferred locations | Chips + "Remote OK" + "Open to relocation" | Score: location |
| Include keywords | Chips (boost) | Score: skills |
| Exclude keywords | Chips (default: Senior, Staff, Principal, Lead, Manager, 5+ years, 10+ years) | Hard filter |
| Excluded companies | Picker | Hard filter |
| Relevance threshold | Slider 0–100 (default 55) with a **live count**: "47 of 312 jobs relevant" | Jobs "Relevant" view |
| Freshness window | 7 / 14 / 30 / 45 days | Score: freshness |

Changing any preference triggers a background **re-score** of all jobs (`match_version` increments).

### 10.4 Resume settings

**Base resumes:**
- Upload a `.tex` file (plus `.cls`/`.sty` files, kept beside it) or paste the code.
- Edit in CodeMirror, with a compile-preview button.
- Several bases are allowed (e.g. "SWE", "ML"). One is the default, and the Studio lets you pick another per job.

**Issues:** the base-resume linter runs on every save of a base.

| Detector | Finds | Inline fix |
|---|---|---|
| `TODO` scan (text + comments) | Every `TODO` with its context | Typed field per TODO (date picker for dates, number for CGPA, text otherwise) plus "Omit this line" |
| Author-note comments (`% IMPORTANT`, `% NOTE`, "only if true") | Claims you flagged as uncertain | Confirm true / Remove |
| Link ownership | GitHub links whose owner ≠ your Profile GitHub | Individual / Team + replacement link |
| Header completeness | Missing city, email or phone mismatch with Profile | One-click fix from Profile |
| ATS preamble | Missing `glyphtounicode` / `\pdfgentounicode=1` | One-click add |
| Layout | Forced `\newpage`, empty-text `\href{}`, images/icons in content | One-click fix / dismiss |
| Compile | Base fails to compile | Opens the error line |

Resolved issues are written into both the base `.tex` and the fact bank and recorded as a new base version, so they can be undone. Dismissed ⚠ items stay dismissed until that line changes.

**Fact bank:**
- An entry list (experience, projects, education, certifications, achievements).
- For each bullet: text, **metrics** chips and **skills** chips (auto-extracted, editable), plus "show on base" or "extra (fact bank only)".
- Experience entries can be locked (never dropped).

**Skills inventory:** chips with categories. Adding a skill means "I confirm I have this". Missing JD skills suggested by the ATS report land here as **pending**, and they're used only after you tick ✓.

**Output:**

| Setting | Default |
|---|---|
| Max pages | **1 / 2** (default 2) |
| PDF filename pattern | `{First}_{Last}_Resume.pdf` |
| Tailoring style | Conservative (reorder + light rephrase) · **Balanced** · Assertive (more rephrasing; still guarded) |
| Rewrite summary per job | on |
| Projects to include | 2–4 (default 3) |
| Drift warning threshold | 60% |

### 10.5 Application answers

One page, grouped. Every field has a **"Always ask me"** option, which turns it into a ❗ at review.

| Group | Fields |
|---|---|
| Work authorization | Citizenship · Authorized to work in India (Y/N) · Other countries authorized · Need sponsorship now / in future (Y/N) |
| Availability | Notice period (Immediate / 15 / 30 / 60 / 90 days / custom) · Earliest start date (date or "N weeks after offer") · Currently employed (auto from fact bank) |
| Compensation | Currency · Current CTC · Expected CTC (number or range) · "Negotiable" text variant for free-text fields · Leave salary blank when optional (toggle) |
| Work setup | Relocation (Y/N/Depends) · Remote / Hybrid / Onsite preferences · Willing to travel % |
| Voluntary disclosures (EEO) | Gender · Pronouns · Race/ethnicity · Veteran · Disability. Each defaults to **"Decline to self-identify"**. |
| Common questions | "How did you hear about us?" (default: "Company careers page") · Languages known · Referral name (blank) · Over 18 (Y) · Willing to do background check (default **Always ask me**) |
| Attestations | Not configurable: always ask |

**Learned answers** (sub-page): a searchable table of the answer bank with question, answer, scope (global / ATS / company), times used and last used. You can edit, delete or **promote** an entry to a common question.

Notice period, CTC, relocation and gender already exist on `profile.*` and are used by the Telegram and Google Form flows. They stay stored there for compatibility, but are **edited only on this page**, so there's one source of truth.

### 10.6 AI and Apply automation

**AI:**

| Setting | Default |
|---|---|
| Provider | **Claude Code (Pro)** · Manual (copy/paste) · Anthropic API key (masked input) |
| Status | "Claude Code 2.1.81 · logged in ✓", plus a **Test** button |
| Model | CLI default · override (e.g. `sonnet`, `opus`) |
| Timeout | 180 s |
| Daily call cap | 40 |
| Fallback to Manual when unavailable | on |
| Usage today | Shown, with a clear-cache action |

**Apply automation:**

| Setting | Default |
|---|---|
| Browser | **Visible (laptop)** · Headless (server) |
| Session timeout | 20 min |
| Daily submit cap | 20 |
| Duplicate window | 14 days |
| Typing delay | 30–80 ms |
| Screenshot retention | 90 days |
| Extra allowed domains | Chips (for SSO pages like `login.microsoftonline.com`) |
| Automation browser profile | **Open to sign in** · **Reset profile** |

### 10.7 Where settings are stored

| Kind | Store | Examples |
|---|---|---|
| Configuration | Existing settings store (`data/settings.json`, atomic writes, sanitized) | New typed sections: `job_prefs`, `apply_answers`, `resume_prefs`, `ai`, `apply_automation` |
| Secrets | Same store, masked in the API and never logged | API key |
| User data | Database | Resume bases, fact banks, versions, answer bank, field mappings |

Each new section has defaults in `DEFAULTS`, validation in `sanitize()`, and TypeScript types in `lib/types.ts`, following the existing pattern.

---

## 11. Reliability, security, observability

| Area | Measure |
|---|---|
| Task durability | Tasks in the DB, claimed atomically, retried with backoff (3 tries), stuck `running` tasks reclaimed after 10 min |
| Idempotency | `tailor` keyed by (session, facts_version, jd_hash, hint); `submit` refuses unless status = `reviewing`; one active session per job |
| LaTeX sandbox | `-no-shell-escape`, `openin_any=p`, `openout_any=p`, temp dir per build, 60 s kill, AI text escaped before insertion |
| Prompt injection | JD passed as data; Claude runs with **no tools**; output schema-validated; guards are deterministic |
| Browser scope | Navigation allowlist, downloads blocked, dedicated profile, never your main browser profile |
| Secrets | Worker token in `.env`; no credentials in logs; screenshots stay local |
| Auth | Existing app login protects every route, including SSE and PDFs |
| Observability | `application_events` timeline; `llm_calls` log; structured logs `[worker.task=…]`; dashboard counters (sessions/day, auto-fill %, failures by ATS) |
| Failure UX | Every failure has a message plus a next action ("Open in browser", "Retry", "Copy answers", "Switch to manual AI") |

---

## 12. Code layout

```
lib/
  jobs/        ats-detect.ts · jd/{greenhouse,lever,ashby,workable,smartrecruiters,recruitee,workday,generic}.ts
               sanitize.ts · skills-dict.ts · score.ts
  resume/      latex/parse.ts (macro-aware) · latex/render.ts · latex/escape.ts
               facts.ts · jd-analyze.ts · tailor.ts · guards.ts · compile.ts · fit.ts · ats-check.ts
  apply/       ats/{greenhouse,lever,ashby,workable,smartrecruiters,workday,generic}.ts
               extract.ts · resolve/{mapping,rules,answer-bank,options,policy,generate}.ts
               executor.ts · session.ts · confirm.ts · learn.ts
  llm/         provider.ts · claude-code.ts · manual.ts · prompts/{tailor,answer}.ts · schemas/*.json
  setup/       checks.ts (readiness) · installers.ts (whitelisted commands) · lint-base.ts (resume issues)
  tasks/       queue.ts · handlers.ts
  server/      (existing) db.ts + migrations/, settings, auth …
worker/        index.ts (task loop + control API + SSE) · sessions.ts (live browser registry)
app/           jobs/ · jobs/[id]/ · apply/[sid]/ · applications/ · api/…
               settings/{setup,preferences,resume/{bases,issues,facts,skills,output},answers/{,learned},ai,apply}/
tests/         resume-roundtrip · guards · escape · score · resolvers · ats-adapters (saved HTML fixtures)
               e2e: Playwright against local mock ATS pages (never real sites in CI)
```

**New dependencies:** `playwright`, `@codemirror/*` + `@codemirror/legacy-modes`, `pdfjs-dist`, `sanitize-html`. System tools: **MiKTeX** (pdflatex + latexmk) and poppler (`pdftotext`/`pdfinfo`, which you already have).

**Why pdfLaTeX and not Tectonic:** your template's font notes (OT1, Type 1 fonts, the `T1`/`lmodern` warning) are pdfLaTeX-specific. Tectonic uses the XeTeX engine and would produce different output from what you see in Overleaf.

---

## 13. Testing and acceptance

| Test | Pass condition |
|---|---|
| Resume round-trip | parse(base) → render → compile: PDF text identical to the original (whitespace-normalized) |
| Escaping | Text such as `C# & .NET 50% {x}` renders literally and compiles |
| Guards | A plan with an invented "70%" or "Kafka" is rejected and the bullet falls back to the original |
| Fit-to-page | A 3-page render fits into ≤ max pages without touching locked entries |
| ATS check | Detects a missing email, a `TODO`, a broken ligature |
| Scoring | Golden JD fixtures produce stable scores |
| Adapters | Saved Greenhouse/Lever/Ashby form HTML yields the expected field list |
| E2E | Mock ATS: apply → fill → review → submit → `submitted` + events + screenshots |
| Live dry run | One real job per P1 ATS, stopped at review (no submit) |
| Settings | Each new section round-trips through `save()`/`load()`; `sanitize()` rejects bad values; old `settings.json` files load with defaults |
| Setup checks | Each check reports correctly with the tool present and absent; installers accept only whitelisted IDs |
| Resume linter | Your base produces exactly the 10 findings in §5.1; resolving each updates base + fact bank and clears it |
| Readiness gating | Every blocked action shows its reason and a working link to the fix |

---

## 14. Delivery plan

| Phase | Build | Settings delivered | Done when |
|---|---|---|---|
| **1. Foundation + Jobs** | Migrations runner, `tasks` queue, worker process, JD fetchers (incl. Workday), ATS detect, scoring, Jobs list/detail, responsive shell | **Setup & health** (wizard, checks, installers), **Job preferences** (live count, re-score), Companies priority | You see every job with full JD and score on laptop and phone, tuned entirely from Settings |
| **2. Resume Studio** | Macro parser/renderer, pdflatex compile, pdf.js preview, CodeMirror editor, versions/diff, ATS check, TODO block | **Resume**: base resumes, **Issues linter** with inline fixes, fact bank, skills inventory, output | You upload your base, fix its issues in Settings, and it round-trips exactly |
| **3. Tailoring** | LLM provider (claude-code + manual), JD analysis, plan schema, guards, fit-to-page, coverage report, reuse | **AI** (provider, status/test, limits) | "Generate" produces a guarded, compiling, ATS-checked tailored resume |
| **4. Autofill (P1 ATS)** | Playwright persistent executor, Greenhouse/Lever/Ashby/generic adapters, resolver chain, answer bank, review screen, submit + confirmation, events/screenshots | **Application answers** + Learned answers, **Apply automation** (incl. ATS sign-in browser) | End-to-end apply on Greenhouse/Lever/Ashby with review |
| **5. Coverage + polish** | Workable, SmartRecruiters, Workday adapters; learning dashboard; Applications kanban; server/headless mode | Promote-to-common-question, retention cleanup | Most of your companies' ATS covered; tracking complete |

Each phase ships tested and working before the next starts. Existing Telegram and email features keep working throughout.

---

## 15. Setup checklist (all inside the app)

Nothing needs to be sent to a developer. After each phase ships, you do this in the app:

| # | Where | What you do | Phase |
|---|---|---|---|
| 1 | Settings → **Setup & health** | Follow the wizard. Install MiKTeX, poppler and Playwright Chromium with one click each. Log in to Claude Code once in a terminal, then click Recheck. | 1–4 |
| 2 | Settings → **Job preferences** | Target roles, seniority, locations, exclusions, threshold | 1 |
| 3 | Settings → **Companies** | Add companies and career links, set priority | 1 |
| 4 | Settings → **Resume → Base resumes** | Upload or paste your `main.tex` | 2 |
| 5 | Settings → **Resume → Issues** | Resolve the TODOs (graduation date, CGPA, project facts), confirm or remove C#/.NET, set Periodontitis project ownership, apply the one-click ATS fixes | 2 |
| 6 | Settings → **Resume → Skills inventory / Output** | Add extra true skills; choose 1 or 2 pages | 2 |
| 7 | Settings → **AI** | Confirm Claude Code (Pro) shows ✓ and Test passes | 3 |
| 8 | Settings → **Application answers** | Work authorization, sponsorship, notice period, CTC, start date, relocation, EEO, common questions | 4 |
| 9 | Settings → **Apply automation** | Open the automation browser and sign in to any Workday/iCIMS accounts | 4–5 |
| 10 | Jobs | Pick a Greenhouse/Lever/Ashby job and run a full apply, stopping at review the first time | 4 |
