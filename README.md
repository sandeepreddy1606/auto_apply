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
| Backend   | Python 3.11, FastAPI, SQLite, Telethon (Telegram user client), smtplib, requests |
| Frontend  | React 18 + Vite (built bundle is served by the backend) |
| Storage   | `data/auto_apply.db` (applications), `data/settings.json` (profile/config), `data/telegram.session` |

## Run

```powershell
.\start.ps1        # creates venv / builds frontend on first run, then serves
```

Open **http://127.0.0.1:8787**.

Manual equivalent:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
cd ..\frontend
npm install
npm run build
cd ..\backend
.\.venv\Scripts\python run.py
```

Frontend development mode (hot reload, proxies `/api` to :8787):
`cd frontend && npm run dev`

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
