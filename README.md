# Auto Apply

Automated job-application system. It listens to private Telegram channels for
job posts, parses each message with **pure rules (regex + keyword heuristics —
no AI models)**, and applies for you:

- Post contains an **HR email** → sends a templated application email with your
  resume attached (SMTP).
- Post contains a **Google Form** → fetches the form, auto-fills the questions
  from your saved profile, and submits it programmatically.

A web dashboard lets you review every message, edit the parsed details, preview
the email / form answers, apply with one click, and track statuses
(review / applied / failed / manual / skipped).

## Stack

| Part      | Tech |
|-----------|------|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Runtime   | Node.js 24 — one process serves the UI, the API, the Telegram listener and the scan loop |
| Telegram  | teleproto (MTProto user client) |
| Email      | nodemailer (SMTP) |
| Storage   | PostgreSQL when `DATABASE_URL` is set, otherwise a local SQLite file via `node:sqlite` |
| Data      | `data/auto_apply.db`, `data/settings.json`, `data/telegram.session.txt`, `data/resumes/` |

Background work (the Telegram listener and the periodic career-page scan) starts
from `instrumentation.ts`, which Next.js runs once per server process.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:8787, hot reload
```

Production:

```bash
npm run build
npm run start        # http://127.0.0.1:8787
```

Windows: `.\start.ps1` does install + build + start.

Useful scripts:

```bash
npm run typecheck    # tsc --noEmit
npm test             # parity + unit tests (see Tests below)
```

## Using the app

- **Overview** opens with what changed and what needs you. It shows:
  - new matches, applications in progress, applied, and interviews;
  - a "Needs you" list;
  - your top matches;
  - new matches per day;
  - your pipeline from match to offer;
  - a short setup checklist, until it's done.
- **Ctrl K** (⌘K on Mac) opens search from any page: go to a page or a
  Settings section, run an action, or find a job by title or company.
- **Theme:** dark, light, or match your system. Switch it in the sidebar or
  in Settings → Appearance; your choice is remembered on this device.

## Accounts & sign-in

- **First run:** the app opens on **Create account**: name, email and password.
  You then get a one-time **recovery code**; save it. Sign-up closes after
  this first account, because the app holds one person's profile, resumes and
  Telegram login.
- **Sign in** with your email and password. "Keep me signed in" lasts 30 days.
  Untick it on a shared computer, and the session ends when the browser closes
  or after 12 idle hours. Five wrong passwords lock sign-in for 15 minutes.
- **Forgot password:** use your recovery code, or an emailed 6-digit code if
  SMTP is set up. If you've lost both, run `npm run auth:recover` on the
  computer running the app; it prints a new recovery code.
- **Settings → Account & security:** change your name or email, change your
  password (this signs out other devices), make a new recovery code, see every
  signed-in device and sign any of them out.
- **Upgrading from the old single password:** the first visit asks for that
  password plus your name and email, and turns it into an account. Nothing
  else changes.
- **How it's stored:** passwords are hashed with scrypt. Sessions are random
  tokens kept in an httpOnly cookie, and only their hash is stored. Writes made
  with the cookie from another site are blocked. The browser extension still
  works; it uses the same token as a bearer header.

## Setup (one time, in the UI → Settings)

1. **Profile** — name, email, phone, experience, skills, links, and:
   - `Resume file path` — local PDF attached to application emails.
   - `Resume link` — Drive/URL pasted into "resume link" form questions.
2. **SMTP** — for Gmail: enable 2-Step Verification → create an
   **App password** → use it as the password. Send yourself a test email.
3. **Email template** — subject/body with `{job_title}`-style placeholders.
   Lines whose placeholder is empty are dropped automatically.
4. **Telegram** — create API credentials at
   [my.telegram.org](https://my.telegram.org) → *API development tools*.
   Enter api_id / api_hash / phone → **Connect** → enter the login code
   (and 2FA password if set). This uses *your* account, so private groups
   you've joined work, with no bot needed.
   - **Add a job group by name:** under **Job groups**, type the group's name
     (or its @username or t.me link). Choose how far back to read (today, 3
     days, a week…) and press **Watch**.
   - **What happens next:** its job posts land in the **Telegram inbox**,
     separate from the career-page Jobs list. New posts arrive as they're
     posted. Posts made while the app was off are picked up when it
     reconnects, and it re-checks every 15 minutes.
   - **Hidden links are kept:** links behind words ("Apply here") and on
     buttons are recovered.
5. **Automation** (optional):
   - Auto-send emails and/or auto-submit Google Forms for incoming posts.
     Auto-submit only fires when every required form question was confidently
     auto-filled; anything uncertain stays in **review**.
   - **Careers-page links** have two switches. Pressing Apply can submit once
     the form is complete (on by default). Applying can also start on its own
     when a post arrives (off by default).

**Apply on a Telegram post.** One button, three ways, chosen by what the post
asks for:

| The post says | Apply does |
|---|---|
| Send your resume to hr@… | Sends the email with your resume |
| A Google Form link | Fills it from your profile and submits it |
| A careers-page link | Follows short links to the real page, then opens it in the automation browser. Attaches your PDF resume (tagged for the role, else your default) and fills the form from your profile and application answers. Submits when every required answer is filled, it's on the last page and no CAPTCHA showed |

**When a careers page needs you:**
- Sign-ins, CAPTCHAs, legal consent boxes and questions it can't answer stop
  the run, and the post shows what it needs.
- **Finish** opens the form review, with every field and screenshots.
- **Apply to all** applies every ready post. Careers pages are filled one after
  another in the background.

**Kept separate from career-page jobs.** These runs use the same browser engine
as the career-page flow, but belong to the Telegram post. They never appear in
Jobs, Companies or the Applications tracker. They do count toward the daily
limit in Settings → Apply automation.

You can also test without Telegram: sidebar → **Paste message**.

## How each message flows

```
Telegram message ──▶ rule-based parser
                       ├─ finds Google Form link  → method: gform
                       ├─ else finds an email     → method: email
                       └─ else                    → status: manual
                     extracts: role, company, location, experience,
                     CTC, skills, batch, deadline, custom subject line
                            │
                    Applications queue (review)
                            │
        ┌───────────────────┴────────────────────┐
   Email: preview/edit rendered                Google Form: schema fetched from
   subject+body, resume attached,              the public page, questions mapped
   send via SMTP                               to your profile by keywords,
                                               unanswered required ones highlighted,
                                               submitted via the same POST the
                                               browser makes
```

### Google Form limitations (shown in the UI, never silent)

- Forms that **require Google sign-in** and **file-upload questions** cannot be
  automated — those applications are flagged so you can apply manually via the
  link.
- Grid questions are unsupported and flagged the same way.

## Notes

- Duplicate messages (same normalized text) are ignored.
- All credentials stay on your machine in `data/settings.json` — the folder is
  gitignored; don't commit it.
- The Telegram session auto-reconnects on server restart.
- Run **one** instance at a time: the MTProto session must have a single holder,
  so scaling to multiple replicas would log the others out.

## Career-page apply flow

Add companies → see every job with its description and a relevance score →
**Apply** → tailor your LaTeX resume for the job → the app autofills the
application in a real browser → you review every field → submit → tracked.
Design: [`report/CAREER_APPLY_FLOW.md`](report/CAREER_APPLY_FLOW.md).

```
Jobs ─▶ Apply ─▶ ① Resume Studio ─▶ ② Autofill ─▶ ③ Review ─▶ ④ Submit ─▶ Applications
         (base copy, AI-tailored      (Playwright, visible   (every answer,  (real submit
          versions, LaTeX editor,      Chromium, your PDF     screenshot,     button,
          PDF preview, ATS report)     uploaded)              learning)       confirmation)
```

**Which career URLs work**
- **ATS boards:** Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
  Recruitee and Workday. The scanner reads every opening.
- **Big employers with their own sites:** Amazon (any amazon.jobs page),
  Microsoft (careers.microsoft.com, and other Eightfold-hosted sites) and
  Google (google.com/about/careers). These hold thousands of jobs worldwide, so
  the scanner *searches* them using your **target roles and locations** from
  Settings → Job preferences. With no roles set, it uses the job titles on your
  resume. If you paste a search URL, the scanner uses that search's own filters.
- **Other company pages:** the scanner reads JobPosting data or links to
  individual postings. Section links like "Military careers" are ignored. If a
  page builds its list with JavaScript, it is rendered once in a headless
  browser.

**Companies and scanning**
- **Companies** is where you manage the career pages you watch. Each one shows
  its scan status, when it's scanned next, any error, and its open, relevant,
  new and applied counts. "View jobs" opens Jobs filtered to that company.
- **Jobs** is the one list of openings, with one meaning of "relevant".
- **How scans run:** every scan (adding a company, "Scan now", "Scan all",
  the schedule) runs in the background worker, one at a time per company.
  - Each company is due again after its interval, so restarting the app
    doesn't rescan everything.
  - Failed scans retry later each time: at least an hour after "too many
    requests", and at most a day.
  - **Pause** stops automatic scans.
  - Changing your target roles or locations searches Amazon, Google and
    Microsoft again.
- **Applications are protected:** a company you've applied to can't be
  removed, since that would erase those applications. Pause it instead.
- **Same posting in several cities:** shown once with "+N more". The job page
  links to the other locations.
- **Add a job by link** (Jobs page): a posting you found elsewhere joins the
  list, gets its description and score, and can be applied to.

**What's read from each description:**
- required experience (e.g. "3+ years of non-internship professional software
  development experience") and any higher preferred level;
- education level and field;
- job type, work mode, pay, visa sponsorship, notice period, shift and travel;
- required and preferred skills, from a list of about 220 technologies. Tools
  imply their field (PyTorch → Machine Learning).

These are shown on the job page and used in scoring and in the AI prompts.

**AI prompts:** both AI tasks (tailoring the resume and drafting form answers)
use one structure (`lib/llm/prompts.ts`):
- role, goal, numbered hard rules, a step-by-step method, a quality checklist
  and the exact output;
- the data in labelled blocks, with the job description marked untrusted.

The tailoring prompt also gets a requirements-coverage table: each job skill,
whether your resume has it, and which bullets prove it. Skills you don't have
are marked "do not add".

**Everything is configured in the app** — start at **Settings → Setup & health**,
which checks and one-click-installs what's missing (MiKTeX for pdfLaTeX, Poppler,
Playwright Chromium), then work through Job preferences, Resume (your base `.tex`,
its **Issues** with inline fixes, fact bank, skills inventory, output), Application
answers, AI and Apply automation.

- **Costs nothing extra.** Everything is free and local: Playwright, MiKTeX,
  Poppler, SQLite, and your existing Claude subscription through the CLI. The
  app strips API keys and cloud-billing variables before it runs `claude`, so
  AI calls can't fall through to pay-per-use billing. A daily cap protects your
  plan's limits, and manual copy/paste mode needs no AI at all.
- **Matching is strict about what counts as relevant.**
  - Once you set target roles, a job's title must match one of them (synonyms
    count, e.g. SDE = Software Engineer).
  - Jobs asking for much more experience than you have are filtered out
    (more than 2 years beyond yours by default).
  - Both rules can be changed in Job preferences.
- **No MiKTeX yet?** On the Apply page, choose "Use a PDF I already have
  instead" to attach a PDF from Settings → Resumes as-is. You can start an
  application with only a PDF; the LaTeX resume is needed only for tailoring.
- **When a site needs you:**
  - **Sign-in walls** stop the robot before it types anything. That includes
    email-first pages like Amazon, Google and Microsoft. Sign in inside the
    automation window, then press **Continue filling**. Filling carries on in
    the same tab.
  - **Other forms it can handle:** "Apply" links that open a new tab, and
    application forms embedded in an iframe.
  - **Anything it can't finish:** unusual widgets, or more than 8 pages.
    Complete it in the window and press **I submitted it myself**; it's
    tracked like any other application.
  - **Show browser window** reopens the form if the tab was closed.
- **Changing your mind:** you can pick a different resume even after the form
  was filled. The next fill uploads the new one and keeps your answers.
- **Nothing is submitted unseen, and nothing gets stuck.**
  - If the browser tab closed before you pressed Submit, the form is filled
    again and shown to you first.
  - If the app stops mid-fill, that application shows "Try again".
  - If it stops mid-submit, it asks you whether the application went through.
    It never clicks Submit twice.
- **Profile autofill:** empty profile fields are filled once from your resume
  (name, email, phone, links, education, current role). Settings → Profile also
  has a button to do it again; it never overwrites what you've typed.
- **AI uses your Claude Pro plan** through the local Claude Code CLI
  (`claude -p --json-schema … --tools ""`), signed in once with `claude` → `/login`.
  Manual copy/paste mode works without it.
- **No invented claims**: the AI only returns a JSON plan (which facts to keep,
  how to reword them); code rejects any new number, technology, employer or date,
  renders into *your* template, compiles, fits to your page limit and runs an ATS check.
- **A background worker** (`worker/index.ts`) runs browser automation, Claude
  calls and description fetches. The web server starts and supervises it
  automatically; `npm run worker` runs it by hand (`AUTO_APPLY_NO_WORKER=1` to
  stop the server from starting one).
- Files live in `data/`: resume versions (`data/resumes/versions/`), screenshots
  (`data/apply/`), the automation browser profile (`data/browser-profile/`),
  logs (`data/logs/worker.log`). A `data/seed/base_resume.tex` is imported as
  your default base resume on first run.

## Tests

```bash
npm test                    # unit: parity + auth/settings + career flow (151 tests)
npm run build && npm run test:integration   # browser + full-stack (31 tests)
AA_LIVE=1 node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs \
  --test tests/live/tailor-live.test.ts     # one real Claude Code call (uses your Pro limit)
```

- **Golden parity** — pins message parsing, job-title matching, email template
  rendering and Google Form field mapping against snapshots in
  `tests/fixtures/golden/`. Those snapshots were generated by the original Python
  implementation and verified byte-identical against this port before the Python
  was removed, so a diff here means behaviour drifted from the system this
  replaced.
- **Unit**: accounts (sign-up, login lockout, sessions, password change,
  recovery-code and emailed-code reset, cookie/CSRF helpers), the upgrade from
  the old single password (`tests/auth-legacy.test.ts`), and the settings
  merge/sanitise rules, all against a throwaway `AUTO_APPLY_DATA_DIR`.
- **Career flow (unit)** — `tests/career.test.ts` (skills, JD analysis, scoring,
  ATS detection, HTML sanitising, the lossless LaTeX round trip on a real resume,
  fact bank, tailoring guards, plan application, the base-resume linter, the
  answer resolver) and `tests/career-db.test.ts` (migrations, task queue, settings
  sections, resume store/undo, sessions + state machine, answer bank, rescoring).
- **Integration** — `tests/integration/apply-flow.test.ts` fills, reviews and
  submits local mock application forms in headless Chromium (single page,
  multi-step, sign-in walls including email-first, continuing in the same tab
  after sign-in, Apply in a new tab, a form inside an iframe, a hidden upload
  input, a page with no buttons, no unseen submit after the tab closed,
  validation error, navigation allowlist);
  `tests/integration/server.test.ts` boots the production server + worker and
  drives the HTTP API end to end with the manual AI provider.
- `node scripts/ui-snapshots.mjs <dir>` screenshots the main pages at laptop and
  phone widths against demo data (needs a build).

## Migrating from the Python build

Data carries over: `data/auto_apply.db`, `data/settings.json`, `data/auth.json`
and `data/resumes/` are read unchanged, and the schema is identical.

The one thing that does not carry over is the Telegram login. Telethon stored a
SQLite session at `data/telegram.session`; teleproto stores a string session at
`data/telegram.session.txt`. Reconnect once via **Settings → Telegram** (phone →
code → 2FA), then re-tick your watched channels.
