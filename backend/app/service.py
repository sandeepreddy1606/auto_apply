"""Core workflows: ingest a message, apply via email, apply via Google Form."""
import asyncio
import logging
from datetime import datetime, timezone

from . import database as db
from . import gform, mailer, parser, settings_store

log = logging.getLogger("autoapply.service")


def _now():
    return datetime.now(timezone.utc).isoformat()


def ingest_text(text: str, source: str = "manual", channel: str | None = None) -> dict | None:
    """Parse a raw message and store it as an application. Returns None on duplicate."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty message.")
    thash = parser.text_hash(text)
    if db.hash_exists(thash):
        return None

    parsed = parser.parse_message(text)
    status = "review"
    status_reason = None
    if parsed["method"] == "unknown":
        status = "manual"
        status_reason = "No HR email or Google Form link found in the message."

    record = db.insert_application({
        "source": source,
        "channel": channel,
        "raw_text": text,
        "text_hash": thash,
        "method": parsed["method"],
        "email_to": parsed["email_to"],
        "form_url": parsed["form_url"],
        "job_title": parsed["job_title"],
        "company": parsed["company"],
        "location": parsed["location"],
        "experience": parsed["experience"],
        "salary": parsed["salary"],
        "extra": {
            **parsed["extra"],
            "all_emails": parsed["all_emails"],
            "all_form_urls": parsed["all_form_urls"],
            "other_urls": parsed["other_urls"],
            "subject_hint": parsed["subject_hint"],
        },
        "email_subject": parsed["subject_hint"],
        "status": status,
        "status_reason": status_reason,
    })
    return record


def email_preview(app: dict) -> dict:
    settings = settings_store.load()
    ctx = mailer.build_context(settings["profile"], app)
    template = settings["email_template"]
    subject = app.get("email_subject") or mailer.render_template(template["subject"], ctx)
    body = app.get("email_body") or mailer.render_template(template["body"], ctx)
    return {"to": app.get("email_to"), "subject": subject, "body": body,
            "attachment": settings["profile"].get("resume_path") or None}


def apply_email(app: dict, overrides: dict | None = None) -> dict:
    overrides = overrides or {}
    preview = email_preview(app)
    to_addr = overrides.get("to") or preview["to"]
    subject = overrides.get("subject") or preview["subject"]
    body = overrides.get("body") or preview["body"]
    settings = settings_store.load()
    resume = settings["profile"].get("resume_path") or None

    try:
        mailer.send_email(settings["smtp"], to_addr, subject, body, resume)
    except Exception as e:
        return db.update_application(app["id"], {
            "status": "failed", "error": str(e),
            "email_to": to_addr, "email_subject": subject, "email_body": body,
        })
    return db.update_application(app["id"], {
        "status": "applied", "applied_at": _now(), "error": None,
        "email_to": to_addr, "email_subject": subject, "email_body": body,
        "status_reason": None,
    })


def load_form(app: dict) -> dict:
    """Fetch + parse the Google Form and suggest answers from the profile."""
    if not app.get("form_url"):
        raise ValueError("This application has no Google Form URL.")
    form = gform.fetch_form(app["form_url"])
    settings = settings_store.load()
    suggested = gform.suggest_answers(form, settings["profile"])
    # keep any answers the user already edited
    stored = app.get("form_answers") or {}
    answers = {**suggested, **stored}
    missing = gform.unanswered_required(form, answers)
    db.update_application(app["id"], {"form_schema": form, "form_answers": answers})
    return {"form": form, "answers": answers, "unanswered_required": missing}


def apply_gform(app: dict, answers: dict | None = None) -> dict:
    try:
        form = app.get("form_schema")
        if not form:
            form = gform.fetch_form(app["form_url"])
        if answers is None:
            settings = settings_store.load()
            answers = {**gform.suggest_answers(form, settings["profile"]),
                       **(app.get("form_answers") or {})}
        missing = gform.unanswered_required(form, answers)
        if missing:
            names = ", ".join(m["title"] for m in missing[:5])
            raise gform.GFormError(f"Required questions are unanswered: {names}")
        gform.submit_form(form, answers)
    except Exception as e:
        return db.update_application(app["id"], {
            "status": "failed", "error": str(e),
            "form_answers": answers if answers is not None else app.get("form_answers"),
        })
    return db.update_application(app["id"], {
        "status": "applied", "applied_at": _now(), "error": None,
        "form_answers": answers, "status_reason": None,
    })


async def ingest_from_telegram(text: str, channel: str):
    """Callback for the telegram listener. Handles optional auto-apply."""
    record = await asyncio.to_thread(ingest_text, text, "telegram", channel)
    if record is None:
        return
    automation = settings_store.load()["automation"]
    try:
        if record["method"] == "email" and automation.get("auto_apply_email"):
            if record.get("email_to") and record.get("job_title"):
                await asyncio.to_thread(apply_email, record)
            else:
                db.update_application(record["id"], {
                    "status_reason": "Auto-apply skipped: parse confidence too low."})
        elif record["method"] == "gform" and automation.get("auto_apply_gform"):
            await asyncio.to_thread(_auto_apply_gform, record)
    except Exception:
        log.exception("Auto-apply failed for application %s", record["id"])


def _auto_apply_gform(record: dict):
    try:
        form = gform.fetch_form(record["form_url"])
    except gform.GFormError as e:
        db.update_application(record["id"], {
            "status": "manual", "status_reason": str(e)})
        return
    settings = settings_store.load()
    answers = gform.suggest_answers(form, settings["profile"])
    missing = gform.unanswered_required(form, answers)
    db.update_application(record["id"], {"form_schema": form, "form_answers": answers})
    if missing:
        db.update_application(record["id"], {
            "status_reason": "Auto-apply skipped: required questions could not be auto-filled."})
        return
    fresh = db.get_application(record["id"])
    apply_gform(fresh, answers)
