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
   (and 2FA password if set). Then **Load my channels** and tick the job
   channels to watch. This uses *your* account, so private channels you are a
   member of work — no bot needed.
5. **Automation** (optional) — auto-send emails and/or auto-submit forms for
   incoming messages. Auto-submit only fires when every required form question
   was confidently auto-filled; anything uncertain stays in **review**.

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
  instead" to attach a PDF from Settings → Resumes as-is.
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
npm test                    # unit: parity + auth/settings + career flow (112 tests)
npm run build && npm run test:integration   # browser + full-stack (18 tests)
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
  multi-step, sign-in wall, validation error, navigation allowlist);
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
