"""Manage multiple resume files with role-based matching.

Each resume can be tagged with keywords (e.g. "frontend, react"). When applying
to a job, the resume whose keywords match the role is used; if none match, the
one marked default is used. Files live in data/resumes/; metadata lives in
settings.json under "resumes"."""
import os
import uuid
from datetime import datetime, timezone

from . import settings_store
from .paths import RESUMES_DIR

ALLOWED_EXT = {".pdf", ".doc", ".docx", ".rtf", ".odt", ".txt"}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB


def _now():
    return datetime.now(timezone.utc).isoformat()


def list_resumes() -> list[dict]:
    return settings_store.load().get("resumes", []) or []


def _save(items: list[dict]) -> None:
    settings_store.save({"resumes": items})


def _abs(item: dict) -> str:
    return os.path.join(RESUMES_DIR, item["stored"])


def add_resume(original_filename: str, content: bytes, name: str = "",
               keywords: str = "") -> dict:
    ext = os.path.splitext(original_filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise ValueError(f"Unsupported file type '{ext or 'unknown'}'. "
                         "Use PDF, DOC, DOCX, RTF, ODT or TXT.")
    if not content:
        raise ValueError("The uploaded file is empty.")
    if len(content) > MAX_BYTES:
        raise ValueError("File too large (max 10 MB).")

    os.makedirs(RESUMES_DIR, exist_ok=True)
    rid = uuid.uuid4().hex
    stored = rid + ext
    with open(os.path.join(RESUMES_DIR, stored), "wb") as f:
        f.write(content)

    items = list_resumes()
    item = {
        "id": rid,
        "name": (name or "").strip() or (original_filename or "Resume"),
        "original": original_filename or (rid + ext),
        "stored": stored,
        "keywords": (keywords or "").strip(),
        "is_default": len(items) == 0,   # first resume added is the default
        "size_kb": round(len(content) / 1024, 1),
        "added_at": _now(),
    }
    items.append(item)
    _save(items)
    return item


def update_resume(rid: str, fields: dict) -> dict:
    items = list_resumes()
    target = next((it for it in items if it["id"] == rid), None)
    if not target:
        raise ValueError("Resume not found.")
    if fields.get("name") is not None:
        target["name"] = str(fields["name"]).strip() or target["name"]
    if fields.get("keywords") is not None:
        target["keywords"] = str(fields["keywords"]).strip()
    if fields.get("is_default"):
        for it in items:
            it["is_default"] = (it["id"] == rid)
    _save(items)
    return target


def delete_resume(rid: str) -> None:
    items = list_resumes()
    keep = [it for it in items if it["id"] != rid]
    for it in items:
        if it["id"] == rid:
            try:
                os.remove(_abs(it))
            except OSError:
                pass
    # If the default was removed, promote the first remaining resume.
    if keep and not any(it.get("is_default") for it in keep):
        keep[0]["is_default"] = True
    _save(keep)


def path_for(rid: str) -> str | None:
    for it in list_resumes():
        if it["id"] == rid:
            p = _abs(it)
            return p if os.path.isfile(p) else None
    return None


def filename_for(rid: str) -> str:
    for it in list_resumes():
        if it["id"] == rid:
            return it.get("original") or it.get("name") or "resume"
    return "resume"


def pick_for_job(job_title: str = "", extra_text: str = "") -> dict | None:
    """Return the resume metadata best matching the job: keyword match on the
    role first, then the default. None if there are no resumes on file."""
    items = list_resumes()
    if not items:
        return None
    hay = f"{job_title or ''} {extra_text or ''}".lower()
    for it in items:
        kws = [k.strip().lower() for k in (it.get("keywords") or "").split(",") if k.strip()]
        if kws and any(k in hay for k in kws) and os.path.isfile(_abs(it)):
            return it
    for it in items:
        if it.get("is_default") and os.path.isfile(_abs(it)):
            return it
    return None


def pick_path_for_job(job_title: str = "", extra_text: str = "") -> str | None:
    it = pick_for_job(job_title, extra_text)
    return _abs(it) if it else None
