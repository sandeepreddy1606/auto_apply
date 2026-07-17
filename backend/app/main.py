"""FastAPI application: REST API + serves the built frontend."""
import asyncio
import logging
import os
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import database as db
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
    state: str  # new | seen | dismissed


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


# ---------- applications ----------

@app.get("/api/health")
def health():
    return {"ok": True}


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
    record = service.ingest_text(body.text, source="manual", channel=body.channel)
    if record is None:
        raise HTTPException(409, "This message was already ingested (duplicate).")
    return record


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
    if method == "email":
        overrides = {k: v for k, v in body.model_dump().items()
                     if k in ("to", "subject", "body") and v}
        updated = await asyncio.to_thread(service.apply_email, record, overrides)
    elif method == "gform":
        updated = await asyncio.to_thread(service.apply_gform, record, body.answers)
    else:
        raise HTTPException(400, "No apply method for this message. Set method to email or gform first.")
    return updated


# ---------- settings ----------

@app.get("/api/settings")
def get_settings():
    return settings_store.load()


@app.get("/api/settings/defaults")
def get_settings_defaults():
    return settings_store.DEFAULTS


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
        if "UNIQUE" in str(e):
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
    if body.state not in ("new", "seen", "dismissed"):
        raise HTTPException(400, "state must be new, seen or dismissed")
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
