"""JSON-file settings store (profile, SMTP, templates, telegram, automation)."""
import copy
import json
import os
import threading

from .paths import SETTINGS_PATH

_lock = threading.Lock()

DEFAULTS = {
    "profile": {
        "full_name": "",
        "email": "",
        "phone": "",
        "current_location": "",
        "preferred_location": "",
        "experience_years": "",
        "current_company": "",
        "current_role": "",
        "notice_period": "",
        "current_ctc": "",
        "expected_ctc": "",
        "skills": "",
        "degree": "",
        "college": "",
        "graduation_year": "",
        "gender": "",
        "date_of_birth": "",
        "willing_to_relocate": "Yes",
        "linkedin": "",
        "github": "",
        "portfolio": "",
        "resume_url": "",
        "resume_path": "",
        "cover_note": "",
    },
    "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "username": "",
        "password": "",
        "from_name": "",
        "use_ssl": False,
    },
    "email_template": {
        "subject": "Application for {job_title} - {full_name}",
        "body": (
            "Dear Hiring Team,\n\n"
            "I came across your opening for the {job_title} role and would like to "
            "submit my application.\n\n"
            "A quick summary of my profile:\n"
            "- Experience: {experience_years}\n"
            "- Key skills: {skills}\n"
            "- Current location: {current_location}\n"
            "- Notice period: {notice_period}\n\n"
            "I have attached my resume for your review. You can also find my work here:\n"
            "LinkedIn: {linkedin}\n"
            "GitHub: {github}\n"
            "Portfolio: {portfolio}\n\n"
            "I would welcome the opportunity to discuss how I can contribute to your team.\n\n"
            "Best regards,\n"
            "{full_name}\n"
            "{phone}\n"
            "{email}"
        ),
    },
    "telegram": {
        "api_id": "",
        "api_hash": "",
        "phone": "",
        "watched_chats": [],
    },
    "automation": {
        "auto_apply_email": False,
        "auto_apply_gform": False,
    },
    "companies": {
        "match_keywords": "",
        "scan_interval_minutes": 180,
        "auto_scan": True,
    },
    # Uploaded resumes: [{id, name, original, stored, keywords, is_default, size_kb, added_at}]
    "resumes": [],
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load() -> dict:
    with _lock:
        if os.path.exists(SETTINGS_PATH):
            try:
                with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                    saved = json.load(f)
            except (json.JSONDecodeError, OSError):
                saved = {}
        else:
            saved = {}
    return _deep_merge(DEFAULTS, saved)


def _sanitize(settings: dict) -> dict:
    """Normalize values so bad input can't break sending later."""
    for section in ("profile", "smtp", "telegram", "companies"):
        for k, v in settings.get(section, {}).items():
            if isinstance(v, str):
                settings[section][k] = v.strip()
    companies = settings.get("companies", {})
    try:
        minutes = int(str(companies.get("scan_interval_minutes", "")).strip())
        companies["scan_interval_minutes"] = min(max(minutes, 15), 1440)
    except (ValueError, TypeError):
        companies["scan_interval_minutes"] = 180
    companies["auto_scan"] = bool(companies.get("auto_scan", True))
    smtp = settings.get("smtp", {})
    try:
        port = int(str(smtp.get("port", "")).strip())
        smtp["port"] = port if 1 <= port <= 65535 else 587
    except (ValueError, TypeError):
        smtp["port"] = 587
    smtp["use_ssl"] = bool(smtp.get("use_ssl"))
    # Windows paths pasted from Explorer often come quoted.
    profile = settings.get("profile", {})
    if profile.get("resume_path"):
        profile["resume_path"] = profile["resume_path"].strip('"').strip()
    return settings


def save(settings: dict) -> dict:
    merged = _sanitize(_deep_merge(load(), settings))
    with _lock:
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
    return merged
