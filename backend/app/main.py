"""FastAPI application: REST API + serves the built frontend."""
import asyncio
import logging
import os
from urllib.parse import urlsplit

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth
from . import database as db
from . import resumes as resume_store
from . import scanner, service, settings_store
from .paths import FRONTEND_DIST
from .tg import manager as tg_manager

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="Auto Apply", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Endpoints reachable without a token. Everything else under /api requires one.
_PUBLIC_API = {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup"}


@app.middleware("http")
async def _auth_gate(request: Request, call_next):
    path = request.url.path
    # Non-API routes (the built frontend) and CORS preflight pass through.
    if request.method == "OPTIONS" or not path.startswith("/api") or path in _PUBLIC_API:
        return await call_next(request)
    # No password configured yet -> let the setup flow through so the UI can
    # bootstrap; all real endpoints stay protected once a password exists.
    if not auth.is_password_set():
        return JSONResponse({"detail": "Set up a password first."}, status_code=401)
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else None
    if not auth.verify_token(token):
        return JSONResponse({"detail": "Not authenticated."}, status_code=401)
    return await call_next(request)


@app.on_event("startup")
async def _startup():
    tg_manager.set_ingest_callback(service.ingest_from_telegram)
    asyncio.create_task(tg_manager.try_autostart())
    asyncio.create_task(_company_scan_loop())


async def _company_scan_loop():
    """Periodically rescan every company's career page in the background."""
    log = logging.getLogger("autoapply.scanloop")
    await asyncio.sleep(30)  # let the server settle first
    while True:
        interval_minutes = 180
        try:
            cfg = settings_store.load().get("companies", {})
            interval_minutes = int(cfg.get("scan_interval_minutes") or 180)
            if cfg.get("auto_scan", True):
                for company in db.list_companies():
                    try:
                        await asyncio.to_thread(
                            scanner.scan_company, company, settings_store.load())
                    except scanner.ScanError as e:
                        log.warning("Scan failed for %s: %s", company["name"], e)
                    except Exception:
                        log.exception("Scan crashed for %s", company["name"])
        except Exception:
            log.exception("Company scan loop error")
        await asyncio.sleep(max(interval_minutes, 15) * 60)


# ---------- models ----------

class IngestBody(BaseModel):
    text: str
    channel: str | None = None


class PatchBody(BaseModel):
    method: str | None = None
    email_to: str | None = None
    form_url: str | None = None
    apply_url: str | None = None
    job_title: str | None = None
    company: str | None = None
    location: str | None = None
    experience: str | None = None
    salary: str | None = None
    email_subject: str | None = None
    email_body: str | None = None
    form_answers: dict | None = None
    status: str | None = None
    notes: str | None = None


class ApplyBody(BaseModel):
    to: str | None = None
    subject: str | None = None
    body: str | None = None
    answers: dict | None = None


class SettingsBody(BaseModel):
    profile: dict | None = None
    smtp: dict | None = None
    email_template: dict | None = None
    telegram: dict | None = None
    automation: dict | None = None
    companies: dict | None = None


class CompanyBody(BaseModel):
    name: str
    career_url: str


class JobStateBody(BaseModel):
    state: str  # new | seen | dismissed | applied


class CodeBody(BaseModel):
    code: str


class PasswordBody(BaseModel):
    password: str


class WatchBody(BaseModel):
    chats: list[dict]  # [{id, title}]


class TestEmailBody(BaseModel):
    to: str


class ResumeCheckBody(BaseModel):
    path: str


class PasswordAuthBody(BaseModel):
    password: str


class ChangePasswordBody(BaseModel):
    current: str
    new: str


class ApplyBatchBody(BaseModel):
    ids: list[int]


class ResumeUpdateBody(BaseModel):
    name: str | None = None
    keywords: str | None = None
    is_default: bool | None = None


# ---------- applications ----------

@app.get("/api/health")
def health():
    return {"ok": True}


# ---------- auth ----------

@app.get("/api/auth/status")
def auth_status(request: Request):
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else None
    return {"password_set": auth.is_password_set(),
            "authenticated": auth.verify_token(token)}


@app.post("/api/auth/setup")
def auth_setup(body: PasswordAuthBody):
    try:
        auth.set_password(body.password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"token": auth.issue_token()}


@app.post("/api/auth/login")
def auth_login(body: PasswordAuthBody):
    if not auth.is_password_set():
        raise HTTPException(400, "No password is set yet.")
    if not auth.verify_password(body.password):
        raise HTTPException(401, "Incorrect password.")
    return {"token": auth.issue_token()}


@app.post("/api/auth/change")
def auth_change(body: ChangePasswordBody):
    try:
        auth.change_password(body.current, body.new)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Old tokens are now invalid (secret rotated); hand back a fresh one.
    return {"token": auth.issue_token()}


@app.get("/api/stats")
def get_stats():
    return db.stats()


@app.get("/api/activity")
def get_activity(days: int = 120):
    return db.activity(days)


@app.get("/api/applications")
def list_applications(status: str | None = None, method: str | None = None,
                      q: str | None = None):
    return db.list_applications(status=status, method=method, q=q)


@app.get("/api/applications/{app_id}")
def get_application(app_id: int):
    record = db.get_application(app_id)
    if not record:
        raise HTTPException(404, "Application not found")
    return record


@app.patch("/api/applications/{app_id}")
def patch_application(app_id: int, body: PatchBody):
    if not db.get_application(app_id):
        raise HTTPException(404, "Application not found")
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    return db.update_application(app_id, fields)


@app.delete("/api/applications/{app_id}")
def delete_application(app_id: int):
    db.delete_application(app_id)
    return {"ok": True}


@app.post("/api/messages/ingest")
def ingest(body: IngestBody):
    records = service.ingest_text(body.text, source="manual", channel=body.channel)
    if not records:
        raise HTTPException(409, "This message was already ingested (duplicate).")
    return {"created": records}


@app.get("/api/applications/{app_id}/email_preview")
def get_email_preview(app_id: int):
    record = db.get_application(app_id)
    if not record:
        raise HTTPException(404, "Application not found")
    return service.email_preview(record)


@app.get("/api/applications/{app_id}/form")
async def get_form(app_id: int):
    record = db.get_application(app_id)
    if not record:
        raise HTTPException(404, "Application not found")
    try:
        return await asyncio.to_thread(service.load_form, record)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/applications/{app_id}/apply")
async def apply(app_id: int, body: ApplyBody):
    record = db.get_application(app_id)
    if not record:
        raise HTTPException(404, "Application not found")
    if record["status"] == "applied":
        raise HTTPException(400, "Already applied.")
    method = record["method"]
    overrides = {k: v for k, v in body.model_dump().items()
                 if k in ("to", "subject", "body") and v}
    # With explicit content (from the detail page) use it; otherwise fall back
    # to the automated one-shot path.
    try:
        if method == "email" and overrides:
            updated = await asyncio.to_thread(service.apply_email, record, overrides)
        elif method == "gform" and body.answers is not None:
            updated = await asyncio.to_thread(service.apply_gform, record, body.answers)
        else:
            updated = await asyncio.to_thread(service.auto_apply, record)
        return updated
    except service.NeedsInput as e:
        # Google Form couldn't be auto-submitted — draft saved, return the
        # questions still needing the user's input (not an error / not failed).
        return {**db.get_application(app_id), "needs_input": True,
                "unanswered_required": e.missing}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/applications/apply_batch")
async def apply_batch(body: ApplyBatchBody):
    """One-click bulk apply. Applies each id via the automated path and reports
    per-item outcomes; skips already-applied and unknown-method posts."""
    results = []
    for app_id in body.ids[:200]:
        record = db.get_application(app_id)
        if not record:
            results.append({"id": app_id, "ok": False, "error": "not found"})
            continue
        if record["status"] == "applied":
            results.append({"id": app_id, "ok": True, "skipped": "already applied"})
            continue
        try:
            updated = await asyncio.to_thread(service.auto_apply, record)
            if not updated:  # deleted mid-batch
                results.append({"id": app_id, "ok": False,
                                "job_title": record.get("job_title"),
                                "error": "removed during apply"})
                continue
            ok = updated["status"] == "applied"
            results.append({"id": app_id, "ok": ok,
                            "job_title": updated.get("job_title"),
                            "error": None if ok else updated.get("error")})
        except service.NeedsInput as e:
            # Draft saved; the user must finish these — not a failure.
            results.append({"id": app_id, "ok": False, "needs_input": True,
                            "job_title": record.get("job_title"),
                            "error": f"{len(e.missing)} question(s) need your input"})
        except Exception as e:
            # One bad item must never abort the batch or discard prior results.
            results.append({"id": app_id, "ok": False,
                            "job_title": record.get("job_title"), "error": str(e)})
    applied = sum(1 for r in results if r.get("ok") and not r.get("skipped"))
    needs_input = sum(1 for r in results if r.get("needs_input"))
    return {"applied": applied, "needs_input": needs_input,
            "total": len(results), "results": results}


# ---------- settings ----------

@app.get("/api/settings")
def get_settings():
    return settings_store.load()


@app.get("/api/settings/defaults")
def get_settings_defaults():
    return settings_store.DEFAULTS


# ---------- resumes ----------

@app.get("/api/resumes")
def get_resumes():
    return {"resumes": resume_store.list_resumes()}


@app.post("/api/resumes")
async def upload_resume(file: UploadFile = File(...), name: str = Form(""),
                        keywords: str = Form("")):
    content = await file.read()
    try:
        return resume_store.add_resume(file.filename, content, name, keywords)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/resumes/{rid}")
def patch_resume(rid: str, body: ResumeUpdateBody):
    try:
        return resume_store.update_resume(rid, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/resumes/{rid}")
def delete_resume(rid: str):
    resume_store.delete_resume(rid)
    return {"ok": True}


@app.get("/api/resumes/{rid}/file")
def resume_file(rid: str):
    path = resume_store.path_for(rid)
    if not path:
        raise HTTPException(404, "Resume file not found.")
    return FileResponse(path, filename=resume_store.filename_for(rid))


@app.post("/api/settings/check_resume")
def check_resume(body: ResumeCheckBody):
    path = body.path.strip().strip('"')
    if not path:
        raise HTTPException(400, "No file path provided.")
    if not os.path.isfile(path):
        return {"exists": False}
    return {
        "exists": True,
        "filename": os.path.basename(path),
        "size_kb": round(os.path.getsize(path) / 1024, 1),
    }


@app.put("/api/settings")
def put_settings(body: SettingsBody):
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    return settings_store.save(payload)


@app.post("/api/settings/test_email")
async def test_email(body: TestEmailBody):
    from . import mailer
    settings = settings_store.load()
    try:
        await asyncio.to_thread(
            mailer.send_email, settings["smtp"], body.to,
            "Auto Apply - test email",
            "This is a test email from your Auto Apply system. SMTP works!",
            settings["profile"].get("resume_path") or None,
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ---------- companies / career-page jobs ----------

def _normalize_career_url(url: str) -> str:
    url = (url or "").strip().strip('"')
    if url and not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    parts = urlsplit(url)
    if not parts.netloc or "." not in parts.netloc:
        raise HTTPException(400, "That doesn't look like a valid URL.")
    return url.rstrip("/")


@app.get("/api/companies")
def list_companies():
    return db.list_companies()


@app.post("/api/companies")
def create_company(body: CompanyBody):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Company name is required.")
    url = _normalize_career_url(body.career_url)
    try:
        return db.add_company(name, url)
    except Exception as e:
        msg = str(e).lower()
        if "unique" in msg or "duplicate" in msg:
            raise HTTPException(409, "That career page URL is already added.")
        raise


@app.delete("/api/companies/{company_id}")
def remove_company(company_id: int):
    if not db.get_company(company_id):
        raise HTTPException(404, "Company not found")
    db.delete_company(company_id)
    return {"ok": True}


@app.post("/api/companies/{company_id}/scan")
async def scan_company(company_id: int):
    company = db.get_company(company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    try:
        result = await asyncio.to_thread(
            scanner.scan_company, company, settings_store.load())
    except scanner.ScanError as e:
        raise HTTPException(400, str(e))
    return {"company": db.get_company(company_id), "result": result}


@app.post("/api/companies/scan_all")
async def scan_all_companies():
    companies = db.list_companies()

    async def _run():
        for c in companies:
            try:
                await asyncio.to_thread(
                    scanner.scan_company, c, settings_store.load())
            except Exception:
                logging.getLogger("autoapply.scanloop").warning(
                    "Manual scan failed for %s", c["name"])

    asyncio.create_task(_run())
    return {"started": len(companies)}


@app.get("/api/company_jobs")
def list_company_jobs(view: str = "matched", company_id: int | None = None,
                      q: str | None = None):
    return db.list_company_jobs(view=view, company_id=company_id, q=q)


@app.get("/api/company_jobs/summary")
def company_jobs_summary():
    return db.company_jobs_summary()


@app.post("/api/company_jobs/mark_seen")
def mark_company_jobs_seen():
    return {"updated": db.mark_company_jobs_seen()}


@app.patch("/api/company_jobs/{job_id}")
def patch_company_job(job_id: int, body: JobStateBody):
    if body.state not in ("new", "seen", "dismissed", "applied"):
        raise HTTPException(400, "state must be new, seen, dismissed or applied")
    job = db.get_company_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return db.set_company_job_state(job_id, body.state)


# ---------- telegram ----------

@app.get("/api/telegram/status")
def telegram_status():
    return tg_manager.status()


@app.post("/api/telegram/connect")
async def telegram_connect():
    return await tg_manager.connect()


@app.post("/api/telegram/code")
async def telegram_code(body: CodeBody):
    return await tg_manager.submit_code(body.code)


@app.post("/api/telegram/password")
async def telegram_password(body: PasswordBody):
    return await tg_manager.submit_password(body.password)


@app.get("/api/telegram/chats")
async def telegram_chats():
    try:
        return await tg_manager.list_chats()
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/telegram/watch")
def telegram_watch(body: WatchBody):
    settings_store.save({"telegram": {"watched_chats": body.chats}})
    return tg_manager.status()


@app.post("/api/telegram/disconnect")
async def telegram_disconnect():
    return await tg_manager.disconnect()


# ---------- frontend ----------

if os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
