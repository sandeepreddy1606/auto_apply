# Auto Apply v3 — Target Architecture

Status: **proposal, for review before implementation** · 2026-11-08

---

## 1. What exists today (audit)

| Requested feature | Today | Gap |
|---|---|---|
| **Add companies + career links** | ✅ `companies` table, add/edit/delete UI | No reputation tier, no ATS auto-detect, no per-company settings |
| **Fetch all jobs from career pages** | 🟡 Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee via JSON APIs; other sites use a plain HTML link scraper | Workday, iCIMS, Taleo, Oracle, SuccessFactors and JS-rendered pages return nothing. Job descriptions aren't fetched, only titles. |
| **List jobs relevant to my profile** | 🟡 Title-keyword match plus a seniority check (`lib/server/matching.ts`) | Pass/fail only, no score. Ignores the JD, skills overlap, location and freshness. |
| **Click Apply → automated application** | ❌ for career-page jobs: "Apply" only sets `state='applied'` | No ATS form filling, no resume upload, no answer bank |
| **Telegram group jobs → capture + auto-fill** | ✅ MTProto listener, rule parser, email + Google Form auto-apply, Chrome extension for sign-in forms | Telegram posts and career jobs sit in separate tables, so there's no unified inbox |
| **WhatsApp group jobs** | ❌ | Entire source missing |
| **LinkedIn referral suggestions for top companies** | ❌ | No contacts, no reputation tiers, no referral tracking |
| **Everything tracked** | 🟡 One status field (`review/applied/failed/manual/skipped`) | No pipeline stages after "applied" (interview, offer, rejection) and no event history |
| **Laptop + mobile UI** | 🟡 Mobile-first, but `.shell { max-width: 560px }` | Laptop shows a narrow phone column. No sidebar, tables or split views. |

Other structural issues:
- Settings, secrets and resumes live in JSON files on disk instead of the database.
- Background work (Telegram plus the scan loop) runs inside the Next.js web process, so a heavy task like browser automation would block or crash the UI.
- There are no schema migrations: the schema is a list of `CREATE TABLE IF NOT EXISTS` statements.

---

## 2. Target system overview

```
                        ┌─────────────────────── SOURCES ───────────────────────┐
                        │ Career pages   Telegram     WhatsApp     Paste /       │
                        │ (ATS APIs +    (MTProto     (WA Web      extension /   │
                        │  Playwright)    listener)    linked dev)  bookmarklet  │
                        └──────┬────────────┬────────────┬────────────┬─────────┘
                               ▼            ▼            ▼            ▼
                        ┌──────────────────────────────────────────────────────┐
                        │ INGEST PIPELINE  (worker process, queue-driven)       │
                        │  raw capture → parse → normalize → dedupe → enrich JD │
                        │  → company resolve → MATCH SCORE → referral check     │
                        └──────────────────────────┬───────────────────────────┘
                                                   ▼
   ┌────────────┐   ┌──────────────────────────────────────────────────────────┐
   │ Next.js    │◀─▶│                   PostgreSQL                             │
   │ web + API  │   │ jobs · applications · events · companies · contacts ·    │
   │ (UI, REST, │   │ referrals · source_messages · answer_bank · task queue   │
   │  SSE live) │   └──────────────────────────┬───────────────────────────────┘
   └─────┬──────┘                              ▼
         │ enqueue                ┌──────────────────────────────────────────┐
         └───────────────────────▶│ APPLY ENGINE (worker)                    │
                                  │  adapters: Email · Google Form ·         │
                                  │  Greenhouse · Lever · Ashby · Workable · │
                                  │  SmartRecruiters · Generic(Playwright) · │
                                  │  Extension-assisted (Workday/iCIMS/…)    │
                                  └──────────────────────────────────────────┘
                                  ┌──────────────────────────────────────────┐
                                  │ NOTIFIER: web push (PWA) + Telegram bot  │
                                  └──────────────────────────────────────────┘
```

### Processes

| Process | Responsibility | Why separate |
|---|---|---|
| **web** (Next.js) | UI, REST API, auth, live updates over SSE | Stays responsive and can restart freely |
| **worker** (Node, singleton) | Telegram + WhatsApp listeners, scan scheduler, ingest pipeline, apply engine, notifier | Both MTProto and WA sessions need exactly one holder. Playwright is heavy and can crash without taking down the UI. |
| **postgres** | All state, plus the job queue | One source of truth |

Communication goes through the database only. The web process enqueues tasks into a **pg-boss** queue, the worker consumes them, and the worker announces changes with `NOTIFY` so the web process can push them to the UI over SSE. Nothing needs Redis.

---

## 3. Data model

All tables get `created_at` and `updated_at`. Migrations move to **Drizzle ORM + drizzle-kit**. SQLite support stays for local dev only.

```
companies
  id, name, slug, career_url, ats_type (greenhouse|lever|…|workday|custom),
  ats_token, tier (1|2|3), reputation_score 0-100, linkedin_url, domain,
  scan_enabled, scan_interval_min, last_scan_id, notes

scan_runs                 -- tracks every scan
  id, company_id, started_at, finished_at, status, found, new, gone,
  matched, error, duration_ms

source_channels           -- Telegram/WhatsApp groups being watched
  id, platform (telegram|whatsapp), external_id, title, enabled, last_msg_at

source_messages           -- every raw message, kept forever for audit/re-parse
  id, channel_id, external_msg_id, sender, received_at, text, text_hash UNIQUE,
  parse_status, parsed json

jobs                      -- ONE unified table for every source
  id, source (career|telegram|whatsapp|manual|extension), source_ref,
  company_id NULL, company_name, title, location, remote, employment_type,
  experience_min, experience_max, salary, description, posted_at,
  url, apply_method (ats|email|gform|link|unknown), apply_target,
  ats_type, dedupe_key UNIQUE, first_seen_at, last_seen_at, active,
  match_score 0-100, match_breakdown json, match_version,
  inbox_state (new|shortlisted|dismissed|archived),
  referral_recommended bool

applications
  id, job_id, resume_id, method, status, stage, payload json
  (email subject/body | form answers | ats field map), screenshot_path,
  submitted_at, error, needs_input json, next_action_at, notes

application_events        -- full timeline: created, queued, filled, needs_input,
  id, application_id,       submitted, failed, retried, stage_changed, note…
  type, actor (user|system), data json, at

answer_bank               -- remembers how you answered custom questions
  id, question_norm, question_raw, answer, field_type, uses, last_used_at

resumes                   -- moved from JSON → DB (file bytes stay on disk/S3)
  id, name, path, keywords, is_default, size_kb

contacts                  -- from LinkedIn Connections.csv + manual adds
  id, full_name, company_id NULL, company_raw, position, profile_url,
  email, connected_on, relationship (1st|alumni|ex-colleague|other), tags

referrals
  id, company_id, job_id NULL, contact_id NULL, status, message,
  sent_at, follow_up_at, outcome, notes

referral_events           -- same pattern as application_events

settings                  -- key/value json; secrets AES-GCM encrypted with
  key, value, updated_at     APP_SECRET from env
```

### Application state machine

```
draft ─▶ queued ─▶ filling ─┬─▶ needs_input ─(you answer)─▶ queued
                            ├─▶ ready_for_review ─(you approve)─▶ submitting
                            └─▶ submitting ─┬─▶ submitted
                                            └─▶ failed ─(retry ≤3)─▶ queued

submitted ─▶ stage: applied → screening → interview → offer → accepted
                                  └──────────────▶ rejected / ghosted (auto after N days)
```

Every transition writes a row to `application_events`. The UI timeline is built from those rows.

---

## 4. Feature designs

### 4.1 Company career scanning

1. **ATS auto-detect when a company is added.** The app inspects the URL and page HTML: `boards.greenhouse.io`, `jobs.lever.co`, `myworkdayjobs.com`, `icims.com`, `oraclecloud.com/hcmUI`, `successfactors`, plus embedded scripts such as `grnhse_app` and the Lever iframe. It stores `ats_type` and `ats_token`, and shows "Detected: Workday ✓" in the form.
2. **Adapter per ATS** (`lib/sources/career/<ats>.ts`). Each one implements `list(): RawJob[]` and `detail(job): {description, location, posted_at, apply_fields?}`.
   - JSON APIs: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, and **Workday** (`/wday/cxs/<tenant>/<site>/jobs`, a public POST API).
   - **Playwright fallback** for JS-rendered custom pages: render the page, wait for network idle, extract job links with the existing heuristics and paginate. It runs only when the cheaper paths return nothing.
3. **Incremental sync.** New jobs fetch their JD once. Jobs that disappear are marked `active=false` and kept in history. Each run writes a `scan_runs` row, and the Companies page shows scan health (last run, errors, jobs/day).
4. **Scheduler.** Each company has its own interval (default 3 h, 1 h for tier-1). Scans run with concurrency 3 and per-host rate limits.

### 4.2 Relevance matching (explainable score)

`match_score = Σ weight × component`. The UI shows the breakdown, for example *"86 — title ✓, 7/9 skills, exp 2–4 fits your 3 y, Hyderabad ✓"*.

| Component | Weight | Rule |
|---|---|---|
| Title / role fit | 35 | Target roles you list (e.g. "Backend Engineer", "SDE") plus synonyms, matched against the title |
| Skills overlap | 30 | Profile skills found in the JD (word-boundary match, alias table: `js↔javascript`, `k8s↔kubernetes`) |
| Experience fit | 15 | JD's min–max years against your years. Uses the current seniority rules when the JD has no range. |
| Location / remote | 10 | Preferred locations, remote OK, willing to relocate |
| Freshness | 5 | Decays over 30 days |
| Company tier | 5 | Tier-1 gets a boost |

Jobs above the inbox threshold (default 60) show as "Relevant", and jobs above the auto-apply threshold (default 80) can be auto-queued, depending on the rules. Hard filters such as excluded companies or keywords like "unpaid" drop a job to 0. A `match_version` field lets the app re-score everything when your profile changes.

*Optional:* an LLM re-rank or JD summary behind a setting, off by default. That keeps the current "no AI" guarantee unless you opt in.

### 4.3 Apply engine

One interface: `adapter.prepare(job, profile) → {fields, missing[]}` and `adapter.submit(prepared) → result`.

| Target | How | Fully automatic? |
|---|---|---|
| HR email | Existing SMTP mailer, resume picked per job | ✅ |
| Google Form (public) | Existing HTTP POST | ✅ when every required field is filled |
| Google Form (sign-in) | Existing Chrome extension | Semi: extension fills, you click |
| **Greenhouse / Lever / Ashby / Workable / SmartRecruiters** | **Playwright** opens the hosted apply page, fills standard fields, **uploads your resume file**, fills custom questions from the profile and answer bank, screenshots, then submits | ✅ when there are no unknown required fields and no CAPTCHA. Otherwise → `needs_input` or `ready_for_review`. |
| Workday / iCIMS / Taleo / SuccessFactors | These need a candidate account per company. **Extension-assisted**: the extension fills each page in your logged-in browser. | Semi |
| Unknown site | Open link and track manually | Manual |

Safety rules (configurable in **Settings → Automation**):
- **Mode per source:** `off` · `prepare only` (fills, waits for your approval with a screenshot) · `auto-submit`. Default is *prepare only* for ATS and *auto-submit* for email and form, matching today.
- Auto-submit never fires on a CAPTCHA, an unknown required question or a low-confidence answer. Those go to `needs_input`, and **your answer is saved to the answer bank**, so the same question is automatic next time.
- Daily cap per source and per company (default 25/day, 1 per company per job). Random human-like delays.
- **Referral hold:** a tier-1 company job with an available referral path is held as `draft` for N days (default 3) while you ask for a referral.
- Every submission stores the payload plus a screenshot for proof.

### 4.4 Telegram (upgrade) + WhatsApp (new)

Both feed the same pipeline: `source_messages → parser → jobs`. The existing rule parser (`lib/server/parser.ts`) is reused as is, and its golden tests keep it stable.

- **Telegram:** keep teleproto and move it into the worker. Add per-channel enable/disable, a message log with parse status, and "re-parse" after parser improvements.
- **WhatsApp:** there is **no official API that reads groups** (the Cloud/Business API only handles 1:1 business chats). The only way is a **linked-device session via [Baileys](https://github.com/WhiskeySockets/Baileys)**: scan a QR code in Settings, as with WhatsApp Web, pick the groups to watch, and read **only**. The app never sends to groups.
  - ⚠️ This is unofficial and against WhatsApp's ToS. Accounts can be banned, though read-only use is low-risk. Use a secondary number if you can. Shown as an explicit warning in the UI.
  - Images with text (poster-style job posts): optional OCR with tesseract.js, behind a setting.
- Cross-source dedupe uses `dedupe_key = hash(company + normalized title + apply target)`, so the same job posted in five groups shows up once, listing all five sources.

### 4.5 LinkedIn referral suggestions

LinkedIn has no public API for your connections, and scraping it gets accounts restricted. So nothing logs into LinkedIn. Instead:

1. **Import your network.** In LinkedIn, go to *Settings → Data privacy → Get a copy of your data → Connections* and upload the `Connections.csv` it gives you. That fills `contacts` with name, company, position, URL and connected date. Re-import anytime; the app merges by URL. You can also add contacts manually (alumni, ex-colleagues).
2. **Company reputation.** Each company gets a tier (1 = dream or high-reputation, 2, 3). The tier is seeded from a curated list (big tech, top product companies and unicorns), is editable per company, and is also set when you add a company.
3. **Suggestion rule:** a job with `match_score ≥ 70` at a **tier-1 or tier-2** company triggers a **"Ask for referral"** card on the job, the dashboard and the Referrals page:
   - **Contacts at that company**, ranked by role similarity to the job, then seniority (an engineering manager or a peer in the same team ranks first), then how recently you connected.
   - **No contacts?** Pre-built LinkedIn **search deep links** (people at the company with the job's title keyword, and alumni of your college at the company). They open in your own browser. Nothing is automated on LinkedIn.
   - **Message templates** with placeholders (`{first_name}`, `{job_title}`, `{job_url}`, `{my_pitch}`) and a one-click copy. A short connection-note variant (≤300 chars) is included.
4. **Tracking:** `suggested → messaged → replied → referred | declined | no_response`, with follow-up reminders after 4 days by default. A referral that comes through links to the application, and the referral hold (§4.3) is released.

### 4.6 Tracking and notifications

- **Dashboard funnel:** captured → relevant → applied → screening → interview → offer, with conversion by source (career / Telegram / WhatsApp) and by company tier.
- **Per-job and per-application timelines** built from the events tables.
- **Activity heatmap** (exists) plus a weekly summary.
- **Notifications** through web push (the app is already a PWA) and/or a Telegram bot DM to yourself:
  - new job with score ≥ 80
  - needs your input
  - referral follow-up due
  - submission failed
  - scan broken for a company

---

## 5. UI / UX

### Layout: one codebase, two layouts

| | Mobile (< 768 px) | Laptop (≥ 1024 px) |
|---|---|---|
| Nav | Bottom tab bar: **Home · Jobs · Applied · Referrals · More** | Left sidebar with the same items, plus Companies, Sources and Settings, with badges |
| Lists | Cards, swipe right = shortlist, swipe left = dismiss | Dense sortable table |
| Detail | Full-screen sheet | **Split view**: list on the left, detail pane on the right |
| Applications | Segmented list by stage | **Kanban board** by stage (drag to move) |
| Actions | Sticky bottom action bar | Inline buttons plus keyboard shortcuts (`j/k` move, `a` apply, `s` shortlist, `d` dismiss) |

Tablet (768–1023 px) uses the collapsed sidebar with icons only.

### Pages

1. **Home** — today's top matches, *needs your attention* (needs_input, approvals, referral follow-ups), funnel, source health.
2. **Jobs inbox** — every source in one feed. Filters for source, score, company, tier, location, date and state. "Relevant only" is on by default.
3. **Job detail** — JD, score breakdown, source(s), company info, an **Apply** button with the mode shown, a **Referral panel**, and history.
4. **Applications** — kanban or list, each with its timeline, submitted payload, screenshot, retry and stage changes.
5. **Referrals** — suggestions, pipeline, contacts per company, templates.
6. **Companies** — table with tier, ATS, jobs, matched, last scan and health. Bulk add by pasting `name, url` lines or importing a CSV.
7. **Sources** — Telegram and WhatsApp connections, watched groups, live message log with parse results.
8. **Settings** — Profile (target roles, skills, locations), Resumes, Answer bank, Email template, Referral templates, Automation rules, Integrations, Security.

### Design system

**Tailwind CSS v4** plus a small component kit (Radix primitives, shadcn-style): accessible dialogs, sheets, dropdowns and tooltips. Dark and light themes, system default. The current dark aesthetic stays as the dark theme. Skeleton loaders, optimistic updates, and live badges over SSE.

---

## 6. Code layout

```
app/                      Next.js routes (UI + /api)
  (dashboard)/ jobs/ applications/ referrals/ companies/ sources/ settings/
lib/
  db/                     drizzle schema, migrations, queries
  domain/                 pure logic, no I/O (fully unit-tested)
    matching/ parser/ dedupe/ referral-rank/ state-machine/
  sources/
    career/<ats>.ts       one adapter per ATS + playwright fallback
    telegram/ whatsapp/
  apply/
    adapters/<target>.ts  email, gform, greenhouse, lever, …
    answer-bank.ts
  queue/                  pg-boss task definitions
  notify/
worker/index.ts           worker entry: listeners + queue consumers
extension/                Chrome extension (extended to ATS forms)
tests/                    unit (domain), golden (parser), adapter fixtures
```

---

## 7. Infrastructure and security

- `docker-compose`: `web`, `worker` (Playwright image), `postgres` (or Neon), `caddy`. The Oracle free VM in DEPLOY.md runs all of it. Playwright needs about 1 GB RAM, and the A1 instance has 6 GB.
- Secrets (SMTP password, Telegram/WA sessions, API hashes) are encrypted in the database with `APP_SECRET`.
- Auth stays as the single-user password, plus rate-limited login and httpOnly secure cookies (as now).
- Nightly `pg_dump` backup. Structured logs with a task ID on every run.

---

## 8. Delivery plan

| Phase | Scope | Result |
|---|---|---|
| **0. Foundation** | Drizzle schema + migration from the current tables, unified `jobs`, events tables, worker process + pg-boss, settings → DB | Same features, new spine. No data lost. |
| **1. UI shell** | Tailwind, responsive sidebar/bottom-nav, Jobs inbox with split view, Home dashboard | Proper laptop and mobile UI |
| **2. Career scanning v2** | ATS detect, Workday adapter, JD fetch, Playwright fallback, scan_runs, scoring engine | Relevant, ranked jobs from every company |
| **3. Apply engine** | Playwright ATS adapters, answer bank, review/approve flow, screenshots, caps | One-click apply on career jobs |
| **4. WhatsApp** | Baileys QR login, group picker, shared ingest pipeline, cross-source dedupe | WhatsApp jobs captured and auto-filled |
| **5. Referrals** | Tiers, Connections.csv import, ranking, templates, pipeline, referral hold | Referral suggestions for top companies |
| **6. Tracking + notify** | Kanban stages, funnel analytics, web push / Telegram bot alerts | Everything tracked end to end |

Each phase ships working, tested software before the next starts.

---

## 9. Known limits (stated up front)

- **CAPTCHAs** (hCaptcha/reCAPTCHA on some Greenhouse/Lever boards) are never bypassed. Those applications go to *ready for review* so you finish them in one click in your own browser.
- **Account-based ATS** (Workday etc.) can't be applied to server-side. The extension fills them in your own session.
- **WhatsApp** reading is unofficial (see §4.4).
- **LinkedIn** is never automated. Referrals use your exported data and links you open yourself.
- Auto-applying at volume can hurt your reputation with a company. The daily caps and the referral hold exist for that reason.
