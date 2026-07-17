"""SQLite storage for applications. Single-table, JSON columns for nested data."""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from .paths import DB_PATH

_lock = threading.Lock()
_conn = None

JSON_FIELDS = {"extra", "form_schema", "form_answers"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    channel TEXT,
    raw_text TEXT NOT NULL,
    text_hash TEXT UNIQUE,
    method TEXT NOT NULL DEFAULT 'unknown',
    email_to TEXT,
    form_url TEXT,
    job_title TEXT,
    company TEXT,
    location TEXT,
    experience TEXT,
    salary TEXT,
    extra TEXT,
    email_subject TEXT,
    email_body TEXT,
    form_schema TEXT,
    form_answers TEXT,
    status TEXT NOT NULL DEFAULT 'review',
    status_reason TEXT,
    error TEXT,
    applied_at TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    career_url TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_scanned_at TEXT,
    last_status TEXT,
    last_error TEXT,
    jobs_found INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS company_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    matched INTEGER NOT NULL DEFAULT 0,
    match_reason TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'new',
    UNIQUE(company_id, url)
);
CREATE INDEX IF NOT EXISTS idx_company_jobs_company ON company_jobs(company_id);
"""


def _get_conn():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(SCHEMA)
        _conn.commit()
    return _conn


def _now():
    return datetime.now(timezone.utc).isoformat()


def _serialize(fields: dict) -> dict:
    out = {}
    for k, v in fields.items():
        if k in JSON_FIELDS and v is not None and not isinstance(v, str):
            out[k] = json.dumps(v, ensure_ascii=False)
        else:
            out[k] = v
    return out


def _row_to_dict(row) -> dict:
    d = dict(row)
    for k in JSON_FIELDS:
        if d.get(k):
            try:
                d[k] = json.loads(d[k])
            except (json.JSONDecodeError, TypeError):
                pass
    return d


def insert_application(fields: dict) -> dict:
    fields = _serialize(fields)
    fields.setdefault("created_at", _now())
    cols = ", ".join(fields.keys())
    marks = ", ".join("?" for _ in fields)
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            f"INSERT INTO applications ({cols}) VALUES ({marks})", list(fields.values())
        )
        conn.commit()
        new_id = cur.lastrowid
    return get_application(new_id)


def update_application(app_id: int, fields: dict) -> dict | None:
    if not fields:
        return get_application(app_id)
    fields = _serialize(fields)
    sets = ", ".join(f"{k} = ?" for k in fields)
    with _lock:
        conn = _get_conn()
        conn.execute(
            f"UPDATE applications SET {sets} WHERE id = ?",
            list(fields.values()) + [app_id],
        )
        conn.commit()
    return get_application(app_id)


def get_application(app_id: int) -> dict | None:
    with _lock:
        row = _get_conn().execute(
            "SELECT * FROM applications WHERE id = ?", (app_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def hash_exists(text_hash: str) -> bool:
    with _lock:
        row = _get_conn().execute(
            "SELECT 1 FROM applications WHERE text_hash = ?", (text_hash,)
        ).fetchone()
    return row is not None


def list_applications(status: str | None = None, method: str | None = None,
                      q: str | None = None, limit: int = 500) -> list[dict]:
    sql = "SELECT * FROM applications"
    where, params = [], []
    if status:
        where.append("status = ?")
        params.append(status)
    if method:
        where.append("method = ?")
        params.append(method)
    if q:
        where.append("(raw_text LIKE ? OR job_title LIKE ? OR company LIKE ? OR email_to LIKE ?)")
        like = f"%{q}%"
        params += [like, like, like, like]
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with _lock:
        rows = _get_conn().execute(sql, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def delete_application(app_id: int) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        conn.commit()


def stats() -> dict:
    with _lock:
        conn = _get_conn()
        total = conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0]
        by_status = dict(conn.execute(
            "SELECT status, COUNT(*) FROM applications GROUP BY status"
        ).fetchall())
        by_method = dict(conn.execute(
            "SELECT method, COUNT(*) FROM applications GROUP BY method"
        ).fetchall())
        applied_7d = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE applied_at IS NOT NULL "
            "AND substr(applied_at,1,10) >= date('now','-7 day')"
        ).fetchone()[0]
        last_applied = conn.execute(
            "SELECT MAX(applied_at) FROM applications"
        ).fetchone()[0]
        last_received = conn.execute(
            "SELECT MAX(created_at) FROM applications"
        ).fetchone()[0]
    return {"total": total, "by_status": by_status, "by_method": by_method,
            "applied_7d": applied_7d, "last_applied_at": last_applied,
            "last_received_at": last_received}


# ---------- companies / career-page jobs ----------
# Kept in their own tables so scanned jobs never mix with message applications.

def add_company(name: str, career_url: str) -> dict:
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "INSERT INTO companies (name, career_url, created_at) VALUES (?, ?, ?)",
            (name, career_url, _now()),
        )
        conn.commit()
        new_id = cur.lastrowid
    return get_company(new_id)


def get_company(company_id: int) -> dict | None:
    with _lock:
        row = _get_conn().execute(
            "SELECT * FROM companies WHERE id = ?", (company_id,)
        ).fetchone()
    return dict(row) if row else None


def list_companies() -> list[dict]:
    sql = """
    SELECT c.*,
        (SELECT COUNT(*) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.state != 'dismissed') AS active_jobs,
        (SELECT COUNT(*) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.matched = 1 AND j.state != 'dismissed') AS matched_jobs,
        (SELECT COUNT(*) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.matched = 1 AND j.state = 'new') AS new_jobs
    FROM companies c ORDER BY c.name COLLATE NOCASE
    """
    with _lock:
        rows = _get_conn().execute(sql).fetchall()
    return [dict(r) for r in rows]


def update_company(company_id: int, fields: dict) -> dict | None:
    if not fields:
        return get_company(company_id)
    sets = ", ".join(f"{k} = ?" for k in fields)
    with _lock:
        conn = _get_conn()
        conn.execute(f"UPDATE companies SET {sets} WHERE id = ?",
                     list(fields.values()) + [company_id])
        conn.commit()
    return get_company(company_id)


def delete_company(company_id: int) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM company_jobs WHERE company_id = ?", (company_id,))
        conn.execute("DELETE FROM companies WHERE id = ?", (company_id,))
        conn.commit()


def sync_company_jobs(company_id: int, jobs: list[dict]) -> dict:
    """Upsert this scan's jobs; deactivate ones that disappeared from the page.
    User state (new/seen/dismissed) survives rescans."""
    now = _now()
    new = matched = 0
    seen_urls = set()
    with _lock:
        conn = _get_conn()
        for j in jobs:
            seen_urls.add(j["url"])
            if j.get("matched"):
                matched += 1
            row = conn.execute(
                "SELECT id FROM company_jobs WHERE company_id = ? AND url = ?",
                (company_id, j["url"]),
            ).fetchone()
            if row:
                conn.execute(
                    "UPDATE company_jobs SET title = ?, location = ?, matched = ?, "
                    "match_reason = ?, last_seen_at = ?, active = 1 WHERE id = ?",
                    (j["title"], j.get("location"), int(bool(j.get("matched"))),
                     j.get("match_reason"), now, row["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO company_jobs (company_id, url, title, location, matched, "
                    "match_reason, first_seen_at, last_seen_at, active, state) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'new')",
                    (company_id, j["url"], j["title"], j.get("location"),
                     int(bool(j.get("matched"))), j.get("match_reason"), now, now),
                )
                new += 1
        rows = conn.execute(
            "SELECT id, url FROM company_jobs WHERE company_id = ? AND active = 1",
            (company_id,),
        ).fetchall()
        gone = [r["id"] for r in rows if r["url"] not in seen_urls]
        if gone:
            conn.executemany("UPDATE company_jobs SET active = 0 WHERE id = ?",
                             [(g,) for g in gone])
        conn.commit()
    return {"found": len(jobs), "new": new, "matched": matched, "gone": len(gone)}


def list_company_jobs(view: str = "matched", company_id: int | None = None,
                      q: str | None = None, limit: int = 500) -> list[dict]:
    sql = ("SELECT j.*, c.name AS company_name FROM company_jobs j "
           "JOIN companies c ON c.id = j.company_id")
    where, params = [], []
    if view == "dismissed":
        where.append("j.state = 'dismissed'")
    elif view == "all":
        where.append("j.active = 1 AND j.state != 'dismissed'")
    else:  # matched (default)
        where.append("j.active = 1 AND j.matched = 1 AND j.state != 'dismissed'")
    if company_id:
        where.append("j.company_id = ?")
        params.append(company_id)
    if q:
        where.append("(j.title LIKE ? OR c.name LIKE ? OR j.location LIKE ?)")
        like = f"%{q}%"
        params += [like, like, like]
    sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY j.state = 'new' DESC, j.first_seen_at DESC, j.id DESC LIMIT ?"
    params.append(limit)
    with _lock:
        rows = _get_conn().execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def get_company_job(job_id: int) -> dict | None:
    with _lock:
        row = _get_conn().execute(
            "SELECT * FROM company_jobs WHERE id = ?", (job_id,)
        ).fetchone()
    return dict(row) if row else None


def set_company_job_state(job_id: int, state: str) -> dict | None:
    with _lock:
        conn = _get_conn()
        conn.execute("UPDATE company_jobs SET state = ? WHERE id = ?", (state, job_id))
        conn.commit()
    return get_company_job(job_id)


def mark_company_jobs_seen() -> int:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("UPDATE company_jobs SET state = 'seen' WHERE state = 'new'")
        conn.commit()
        return cur.rowcount


def company_jobs_summary() -> dict:
    with _lock:
        conn = _get_conn()
        new_matched = conn.execute(
            "SELECT COUNT(*) FROM company_jobs WHERE active = 1 AND matched = 1 AND state = 'new'"
        ).fetchone()[0]
        total_matched = conn.execute(
            "SELECT COUNT(*) FROM company_jobs WHERE active = 1 AND matched = 1 AND state != 'dismissed'"
        ).fetchone()[0]
        companies = conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
    return {"new_matched": new_matched, "total_matched": total_matched,
            "companies": companies}


def activity(days: int = 120) -> dict:
    """Applications received per day: {'YYYY-MM-DD': count}."""
    with _lock:
        rows = _get_conn().execute(
            "SELECT substr(created_at,1,10) AS d, COUNT(*) FROM applications "
            "WHERE substr(created_at,1,10) >= date('now', ?) GROUP BY d",
            (f"-{days} day",),
        ).fetchall()
    return {r[0]: r[1] for r in rows}
