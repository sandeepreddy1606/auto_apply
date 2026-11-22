# Auto Apply — careers-site jobs

Finds jobs on the career pages you choose and applies to them with you in
control:

1. **Watch companies.** Add any company's careers page (Greenhouse, Lever,
   Ashby, Workday, Workable, SmartRecruiters and more), or search Amazon,
   Google and Microsoft by your roles and locations. Scans run in the
   background on a schedule.
2. **See the jobs that fit.** Every opening gets its full description and a
   relevance score from your target roles, skills, experience and locations,
   with filters for experience, work mode, job type, seniority, location and
   salary.
3. **Apply.** Tailor your LaTeX resume for the job (or attach a PDF). The app
   then fills the application in a real browser from your profile and saved
   answers. You review every field, and nothing is submitted until you approve.
4. **Track it.** Applications move from started to applied, screening,
   interview and offer.

This branch (`career_flow`) contains only the careers-site flow. The Telegram
posts, Google Forms and HR-email flows live on the `development` branch.

## Stack

| Part      | Tech |
|-----------|------|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Runtime   | Node.js — the web server, plus a worker process for scans, browser automation and AI calls |
| Browser   | Playwright (Chromium, or your installed Google Chrome) |
| AI        | Claude Code CLI on your own plan (or manual copy/paste) — no paid API |
| Resume    | LaTeX (MiKTeX / TeX Live) — optional, uploaded PDFs work without it |
| Storage   | PostgreSQL when `DATABASE_URL` is set, otherwise a local SQLite file via `node:sqlite` |
| Data      | `data/auto_apply.db`, `data/settings.json`, `data/resumes/`, `data/browser-profile/` |

Background work (the company-scan loop and the worker) starts from
`instrumentation.ts`, which Next.js runs once per server process.

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
  settings.
- **Sign in** with your email and password. "Keep me signed in" lasts 30 days.
  Untick it on a shared computer, and the session ends when the browser closes
  or after 12 idle hours. Five wrong passwords lock sign-in for 15 minutes.
- **Forgot password:** use your recovery code, or an emailed 6-digit code if
  email is set up (Settings → Email). If you've lost both, run
  `npm run auth:recover` on the computer running the app; it prints a new
  recovery code.
- **Settings → Account & security:** change your name or email, change your
  password (this signs out other devices), make a new recovery code, see every
  signed-in device and sign any of them out.
- **Upgrading from the old single password:** the first visit asks for that
  password plus your name and email, and turns it into an account. Nothing
  else changes.
- **How it's stored:** passwords are hashed with scrypt. Sessions are random
  tokens kept in an httpOnly cookie, and only their hash is stored. Writes made
  with the cookie from another site are blocked. Scripts can send the same
  token as a bearer header.

## Setup (one time, in the UI → Settings)

1. **Job preferences** — target roles, seniority, locations, include/exclude
   keywords. Only matching titles count as relevant.
2. **Profile** — name, email, phone, experience, skills and links. Filled from
   your resume where it can be; used to fill application forms.
3. **Resume** — your LaTeX resume (tailored per job), and/or **Resumes (PDF)**
   tagged by role, which work without LaTeX.
4. **Application answers** — work authorization, notice period, pay,
   relocation, work modes, voluntary disclosures. Answers you type during a
   review are learned and reused.
5. **AI** — Claude Code on your own plan, or manual copy/paste.
6. **Apply automation** — visible or headless browser, which browser, daily
   limit, sites the browser may open.
7. **Email** (optional) — SMTP, only so "Forgot password" can email you a code.

## Notes

- All credentials stay on your machine in `data/` — the folder is gitignored;
  don't commit it.
- The database keeps the tables the full app uses (e.g. Telegram posts), so the
  same `data/` folder works on this branch and on `development`.

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

## Branches

- **`career_flow`** (this branch) holds only the careers-site jobs flow:
  companies, scanning, jobs and matching, resume tailoring, careers-page apply,
  the tracker, accounts and settings.
- **`development`** holds the complete app: this flow plus the Telegram posts,
  Google Forms and HR-email flows. **`main`** is the stable line, updated from
  `development` by pull request.
- A careers-site change made here can be brought to `development` with
  `git cherry-pick`, and the reverse; keep each commit to one flow so that stays
  easy.
- Never committed (see `.gitignore`): `data/` (your database, settings, resumes,
  the signed-in browser profile), `.env`, `node_modules/` and build output
  (`.next/`, `next-env.d.ts`, `*.tsbuildinfo`). A fresh clone creates `data/` on
  first run; copy your own `data/` across to keep your setup.

```bash
git switch career_flow && git pull     # start of a session on this flow
npm test                                # before committing
git add -A && git commit -m "…" && git push
```

## Tests

```bash
npm test                    # unit: parity + auth/settings + career flow (147 tests)
npm run build && npm run test:integration   # browser + full-stack (29 tests)
AA_LIVE=1 node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs \
  --test tests/live/tailor-live.test.ts     # one real Claude Code call (uses your Pro limit)
```

- **Golden parity** — pins the scanner's job-title matching against snapshots
  in `tests/fixtures/golden/`. Those snapshots were generated by the original Python
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
