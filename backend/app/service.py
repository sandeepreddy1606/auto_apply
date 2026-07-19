"""Core workflows: ingest a message, apply via email, apply via Google Form."""
import asyncio
import logging
import threading
from datetime import datetime, timezone

from . import database as db
from . import gform, mailer, parser, resumes, settings_store

log = logging.getLogger("autoapply.service")


class NeedsInput(Exception):
    """Raised when a Google Form can't be auto-submitted because required
    questions are still blank. Carries the list so the UI can show the draft
    and let the user complete it — the post is NOT marked failed."""
    def __init__(self, missing: list[dict]):
        self.missing = missing
        super().__init__(f"{len(missing)} required question(s) need input")


# Guards against sending the same application twice when requests overlap
# (e.g. clicking a row's Apply during a bulk run, or two browser tabs). The
# app runs as a single process, so an in-process id set is sufficient.
_apply_guard = threading.Lock()
_applying: set[int] = set()


def _claim_apply(app_id: int) -> bool:
    with _apply_guard:
        if app_id in _applying:
            return False
        _applying.add(app_id)
        return True


def _release_apply(app_id: int) -> None:
    with _apply_guard:
        _applying.discard(app_id)


def _now():
    return datetime.now(timezone.utc).isoformat()


def ingest_text(text: str, source: str = "manual", channel: str | None = None) -> list[dict]:
    """Parse a raw message and store it. A single message may list several
    openings — each becomes its own application. Returns the created records
    (empty list if everything was a duplicate)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty message.")
    created = []
    for segment in parser.split_openings(text):
        record = _ingest_one(segment, source, channel)
        if record:
            created.append(record)
    return created


def _ingest_one(text: str, source: str, channel: str | None) -> dict | None:
    thash = parser.text_hash(text)
    if db.hash_exists(thash):
        return None

    parsed = parser.parse_message(text)
    status = "review"
    status_reason = None
    if parsed["method"] == "unknown":
        status = "manual"
        status_reason = "No application link, form or email found in the message."
    elif parsed["method"] == "link":
        status_reason = "Applies on an external page — open the link to apply."

    record = db.insert_application({
        "source": source,
        "channel": channel,
        "raw_text": text,
        "text_hash": thash,
        "method": parsed["method"],
        "email_to": parsed["email_to"],
        "form_url": parsed["form_url"],
        "apply_url": parsed.get("apply_url"),
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


def _resume_for(app: dict, settings: dict):
    """Pick the resume to attach for this job: role-matched > default >
    the legacy single profile.resume_path. Returns (path, label)."""
    picked = resumes.pick_for_job(app.get("job_title") or "")
    if picked:
        path = resumes.path_for(picked["id"])
        if path:
            return path, picked["name"]
    legacy = (settings["profile"].get("resume_path") or "").strip() or None
    return legacy, legacy


def email_preview(app: dict) -> dict:
    settings = settings_store.load()
    ctx = mailer.build_context(settings["profile"], app)
    template = settings.get("email_template") or {}
    subject = app.get("email_subject") or mailer.render_template(template.get("subject", ""), ctx)
    body = app.get("email_body") or mailer.render_template(template.get("body", ""), ctx)
    _, label = _resume_for(app, settings)
    return {"to": app.get("email_to"), "subject": subject, "body": body,
            "attachment": label}


def apply_email(app: dict, overrides: dict | None = None) -> dict:
    if not _claim_apply(app["id"]):
        raise ValueError("This job is already being applied.")
    try:
        overrides = overrides or {}
        preview = email_preview(app)
        to_addr = overrides.get("to") or preview["to"]
        subject = overrides.get("subject") or preview["subject"]
        body = overrides.get("body") or preview["body"]
        settings = settings_store.load()
        resume, _ = _resume_for(app, settings)  # role-matched resume, or default

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
    finally:
        _release_apply(app["id"])


def auto_apply(app: dict) -> dict:
    """One-shot apply using stored/generated content — the engine behind the
    'Apply' button. Dispatches by method; raises for methods that can't be
    auto-applied so the caller can report why."""
    method = app.get("method")
    if method == "email":
        if not (app.get("email_to") or "").strip():
            raise ValueError("No HR email on this post — open it to add one.")
        return apply_email(app)
    if method == "gform":
        if not (app.get("form_url") or "").strip():
            raise ValueError("No Google Form URL on this post — open it to add one.")
        return apply_gform(app, None)  # may raise NeedsInput (draft saved)
    if method == "link":
        raise ValueError("This posting applies on an external page — open the link to apply.")
    raise ValueError("No apply method set — open the post and choose email or form.")


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
    if not _claim_apply(app["id"]):
        raise ValueError("This job is already being applied.")
    try:
        # Fetch the form and auto-fill from the profile (merging any answers the
        # user already edited / just submitted).
        try:
            form = app.get("form_schema") or gform.fetch_form(app["form_url"])
            if answers is None:
                settings = settings_store.load()
                answers = {**gform.suggest_answers(form, settings["profile"]),
                           **(app.get("form_answers") or {})}
        except Exception as e:
            return db.update_application(app["id"], {"status": "failed", "error": str(e)})

        # Always persist the pre-filled draft so the UI can show it, even if
        # we can't submit yet.
        db.update_application(app["id"], {"form_schema": form, "form_answers": answers})

        missing = gform.unanswered_required(form, answers)
        if missing:
            # Don't fail — keep it in review with the draft ready, and tell the
            # caller which questions still need the user's input.
            names = ", ".join(m.get("title", "?") for m in missing[:5])
            db.update_application(app["id"], {
                "status_reason": f"{len(missing)} question(s) need your input: {names}"})
            raise NeedsInput(missing)

        try:
            gform.submit_form(form, answers)
        except Exception as e:
            return db.update_application(app["id"], {
                "status": "failed", "error": str(e), "form_answers": answers})
        return db.update_application(app["id"], {
            "status": "applied", "applied_at": _now(), "error": None,
            "form_answers": answers, "status_reason": None,
        })
    finally:
        _release_apply(app["id"])


async def ingest_from_telegram(text: str, channel: str):
    """Callback for the telegram listener. One message may create several
    applications; handle optional auto-apply for each."""
    records = await asyncio.to_thread(ingest_text, text, "telegram", channel)
    if not records:
        return
    automation = settings_store.load()["automation"]
    for record in records:
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
