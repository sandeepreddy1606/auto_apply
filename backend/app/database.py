"""Storage for applications + companies.

Backend is chosen at import time: PostgreSQL when DATABASE_URL is set (e.g. a
Neon connection string), otherwise a local SQLite file. Queries are written once
with '?' placeholders and key-based row access; a thin layer adapts placeholders,
row factories, auto-increment ids and reconnection per backend. JSON columns are
stored as TEXT in both so the rest of the app is identical.
"""
import json
import logging
import threading
from datetime import datetime, timezone, timedelta

from .config import DATABASE_URL
from .paths import DB_PATH

log = logging.getLogger("autoapply.db")

IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))

# Make the active backend obvious in the logs — a mistyped/BOM-corrupted
# DATABASE_URL would otherwise fall back to SQLite silently and write data to
# the wrong place.
if IS_PG:
    log.info("Storage backend: PostgreSQL")
elif DATABASE_URL:
    log.warning("DATABASE_URL is set but is not a postgres:// URL (%r…) — "
                "falling back to local SQLite. Check your .env.", DATABASE_URL[:12])
else:
    log.info("Storage backend: SQLite (%s)", DB_PATH)

if IS_PG:
    import psycopg
    from psycopg.rows import dict_row
else:
    import sqlite3

_lock = threading.RLock()
_conn = None

JSON_FIELDS = {"extra", "form_schema", "form_answers"}

_PK = "SERIAL PRIMARY KEY" if IS_PG else "INTEGER PRIMARY KEY AUTOINCREMENT"
_LIKE = "ILIKE" if IS_PG else "LIKE"

_SCHEMA_STMTS = [
    f"""
    CREATE TABLE IF NOT EXISTS applications (
        id {_PK},
        created_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        channel TEXT,
        raw_text TEXT NOT NULL,
        text_hash TEXT UNIQUE,
        method TEXT NOT NULL DEFAULT 'unknown',
        email_to TEXT,
        form_url TEXT,
        apply_url TEXT,
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
    )
    """,
    f"""
    CREATE TABLE IF NOT EXISTS companies (
        id {_PK},
        name TEXT NOT NULL,
        career_url TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_scanned_at TEXT,
        last_status TEXT,
        last_error TEXT,
        jobs_found INTEGER NOT NULL DEFAULT 0
    )
    """,
    f"""
    CREATE TABLE IF NOT EXISTS company_jobs (
        id {_PK},
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
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_company_jobs_company ON company_jobs(company_id)",
]


# ---------- backend plumbing ----------

def _t(sql: str) -> str:
    return sql.replace("?", "%s") if IS_PG else sql


def _new_conn():
    if IS_PG:
        # prepare_threshold=None avoids server-side prepared statements, which
        # don't play well with Neon's PgBouncer (transaction pooling).
        return psycopg.connect(DATABASE_URL, row_factory=dict_row,
                               prepare_threshold=None, connect_timeout=15)
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init_schema(conn) -> None:
    for stmt in _SCHEMA_STMTS:
        conn.execute(stmt)
    # Migration: add apply_url to databases created before it existed.
    if IS_PG:
        conn.execute("ALTER TABLE applications ADD COLUMN IF NOT EXISTS apply_url TEXT")
    else:
        have = {r[1] for r in conn.execute("PRAGMA table_info(applications)")}
        if "apply_url" not in have:
            conn.execute("ALTER TABLE applications ADD COLUMN apply_url TEXT")
    conn.commit()


def _get_conn():
    global _conn
    if _conn is None:
        conn = _new_conn()
        try:
            _init_schema(conn)
        except Exception:
            # Don't publish a half-initialized connection — a later call must be
            # able to retry schema setup cleanly instead of being stuck forever.
            try:
                conn.close()
            except Exception:
                pass
            raise
        _conn = conn
    return _conn


def _reset() -> None:
    global _conn
    try:
        if _conn is not None:
            _conn.close()
    except Exception:
        pass
    _conn = None


def _is_conn_error(e: Exception) -> bool:
    if IS_PG:
        return isinstance(e, (psycopg.OperationalError, psycopg.InterfaceError))
    return isinstance(e, sqlite3.OperationalError)


def _safe_rollback(conn) -> None:
    try:
        conn.rollback()
    except Exception:
        pass


def _do(action):
    """Run action(conn) under the lock, commit, and retry once if a cloud
    connection has dropped. Returns whatever action returns.

    action() and commit() are handled separately: a connection error while
    running action means nothing was committed, so retrying is safe. A failure
    at commit() is ambiguous (the commit may have applied server-side), so we
    never re-run the action for it — that would double-apply the write."""
    last = None
    for attempt in (1, 2):
        with _lock:
            conn = None
            try:
                conn = _get_conn()
                result = action(conn)
            except Exception as e:
                if conn is not None:
                    _safe_rollback(conn)
                last = e
                if attempt == 1 and _is_conn_error(e):
                    _reset()
                    continue
                raise
            try:
                conn.commit()
                return result
            except Exception as e:
                _safe_rollback(conn)
                if _is_conn_error(e):
                    _reset()  # drop the likely-dead connection, but do NOT retry
                raise
    raise last


def _fetchone(sql, params=()):
    return _do(lambda c: c.execute(_t(sql), params).fetchone())


def _fetchall(sql, params=()):
    return _do(lambda c: c.execute(_t(sql), params).fetchall())


def _exec(sql, params=()):
    _do(lambda c: c.execute(_t(sql), params))


def _exec_rowcount(sql, params=()):
    return _do(lambda c: c.execute(_t(sql), params).rowcount)


def _insert(sql, params):
    def act(conn):
        if IS_PG:
            return conn.execute(_t(sql) + " RETURNING id", params).fetchone()["id"]
        return conn.execute(sql, params).lastrowid
    return _do(act)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _utc_cutoff(days: int) -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()


def _serialize(fields: dict) -> dict:
    out = {}
    for k, v in fields.items():
        if k in JSON_FIELDS and v is not None and not isinstance(v, str):
            out[k] = json.dumps(v, ensure_ascii=False)
        else:
            out[k] = v
    return out


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for k in JSON_FIELDS:
        if d.get(k):
            try:
                d[k] = json.loads(d[k])
            except (json.JSONDecodeError, TypeError):
                pass
    return d


# ---------- applications ----------

def insert_application(fields: dict) -> dict:
    fields = _serialize(fields)
    fields.setdefault("created_at", _now())
    cols = ", ".join(fields.keys())
    marks = ", ".join("?" for _ in fields)
    new_id = _insert(f"INSERT INTO applications ({cols}) VALUES ({marks})",
                     list(fields.values()))
    return get_application(new_id)


def update_application(app_id: int, fields: dict) -> dict | None:
    if not fields:
        return get_application(app_id)
    fields = _serialize(fields)
    sets = ", ".join(f"{k} = ?" for k in fields)
    _exec(f"UPDATE applications SET {sets} WHERE id = ?",
          list(fields.values()) + [app_id])
    return get_application(app_id)


def get_application(app_id: int) -> dict | None:
    return _row_to_dict(_fetchone("SELECT * FROM applications WHERE id = ?", (app_id,)))


def hash_exists(text_hash: str) -> bool:
    return _fetchone("SELECT 1 FROM applications WHERE text_hash = ?", (text_hash,)) is not None


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
        where.append(f"(raw_text {_LIKE} ? OR job_title {_LIKE} ? OR company {_LIKE} ? OR email_to {_LIKE} ?)")
        like = f"%{q}%"
        params += [like, like, like, like]
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    return [_row_to_dict(r) for r in _fetchall(sql, params)]


def delete_application(app_id: int) -> None:
    _exec("DELETE FROM applications WHERE id = ?", (app_id,))


def stats() -> dict:
    total = _fetchone("SELECT COUNT(*) AS n FROM applications")["n"]
    by_status = {r["status"]: r["n"] for r in _fetchall(
        "SELECT status, COUNT(*) AS n FROM applications GROUP BY status")}
    by_method = {r["method"]: r["n"] for r in _fetchall(
        "SELECT method, COUNT(*) AS n FROM applications GROUP BY method")}
    applied_7d = _fetchone(
        "SELECT COUNT(*) AS n FROM applications WHERE applied_at IS NOT NULL "
        "AND substr(applied_at,1,10) >= ?", (_utc_cutoff(7),))["n"]
    last_applied = _fetchone("SELECT MAX(applied_at) AS m FROM applications")["m"]
    last_received = _fetchone("SELECT MAX(created_at) AS m FROM applications")["m"]
    return {"total": total, "by_status": by_status, "by_method": by_method,
            "applied_7d": applied_7d, "last_applied_at": last_applied,
            "last_received_at": last_received}


def activity(days: int = 120) -> dict:
    """Applications received per day: {'YYYY-MM-DD': count}."""
    rows = _fetchall(
        "SELECT substr(created_at,1,10) AS d, COUNT(*) AS c FROM applications "
        "WHERE substr(created_at,1,10) >= ? GROUP BY substr(created_at,1,10)",
        (_utc_cutoff(days),))
    return {r["d"]: r["c"] for r in rows}


# ---------- companies / career-page jobs ----------
# Kept in their own tables so scanned jobs never mix with message applications.

def add_company(name: str, career_url: str) -> dict:
    new_id = _insert(
        "INSERT INTO companies (name, career_url, created_at) VALUES (?, ?, ?)",
        (name, career_url, _now()))
    return get_company(new_id)


def get_company(company_id: int) -> dict | None:
    row = _fetchone("SELECT * FROM companies WHERE id = ?", (company_id,))
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
    """ if not IS_PG else """
    SELECT c.*,
        (SELECT COUNT(*) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.state != 'dismissed') AS active_jobs,
        (SELECT COUNT(*) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.matched = 1 AND j.state != 'dismissed') AS matched_jobs,
        (SELECT COUNT(*) FROM company_jobs j
         WHERE j.company_id = c.id AND j.active = 1 AND j.matched = 1 AND j.state = 'new') AS new_jobs
    FROM companies c ORDER BY lower(c.name)
    """
    return [dict(r) for r in _fetchall(sql)]


def update_company(company_id: int, fields: dict) -> dict | None:
    if not fields:
        return get_company(company_id)
    sets = ", ".join(f"{k} = ?" for k in fields)
    _exec(f"UPDATE companies SET {sets} WHERE id = ?",
          list(fields.values()) + [company_id])
    return get_company(company_id)


def delete_company(company_id: int) -> None:
    def act(conn):
        conn.execute(_t("DELETE FROM company_jobs WHERE company_id = ?"), (company_id,))
        conn.execute(_t("DELETE FROM companies WHERE id = ?"), (company_id,))
    _do(act)


def sync_company_jobs(company_id: int, jobs: list[dict]) -> dict:
    """Upsert this scan's jobs; deactivate ones that disappeared from the page.
    User state (new/seen/dismissed/applied) survives rescans."""
    now = _now()

    def act(conn):
        new = matched = 0
        seen_urls = set()
        for j in jobs:
            seen_urls.add(j["url"])
            if j.get("matched"):
                matched += 1
            row = conn.execute(
                _t("SELECT id FROM company_jobs WHERE company_id = ? AND url = ?"),
                (company_id, j["url"])).fetchone()
            if row:
                conn.execute(_t(
                    "UPDATE company_jobs SET title = ?, location = ?, matched = ?, "
                    "match_reason = ?, last_seen_at = ?, active = 1 WHERE id = ?"),
                    (j["title"], j.get("location"), int(bool(j.get("matched"))),
                     j.get("match_reason"), now, row["id"]))
            else:
                conn.execute(_t(
                    "INSERT INTO company_jobs (company_id, url, title, location, matched, "
                    "match_reason, first_seen_at, last_seen_at, active, state) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'new')"),
                    (company_id, j["url"], j["title"], j.get("location"),
                     int(bool(j.get("matched"))), j.get("match_reason"), now, now))
                new += 1
        rows = conn.execute(
            _t("SELECT id, url FROM company_jobs WHERE company_id = ? AND active = 1"),
            (company_id,)).fetchall()
        gone = [r["id"] for r in rows if r["url"] not in seen_urls]
        for g in gone:
            conn.execute(_t("UPDATE company_jobs SET active = 0 WHERE id = ?"), (g,))
        return {"found": len(jobs), "new": new, "matched": matched, "gone": len(gone)}

    return _do(act)


def list_company_jobs(view: str = "matched", company_id: int | None = None,
                      q: str | None = None, limit: int = 500) -> list[dict]:
    sql = ("SELECT j.*, c.name AS company_name FROM company_jobs j "
           "JOIN companies c ON c.id = j.company_id")
    where, params = [], []
    if view == "everything":
        # Active postings, plus any the user has acted on (applied/dismissed) so
        # that history survives a rescan that deactivates a vanished posting.
        where.append("(j.active = 1 OR j.state IN ('applied', 'dismissed'))")
    elif view == "dismissed":
        where.append("j.state = 'dismissed'")
    elif view == "all":
        where.append("j.active = 1 AND j.state != 'dismissed'")
    else:  # matched (default)
        where.append("j.active = 1 AND j.matched = 1 AND j.state != 'dismissed'")
    if company_id:
        where.append("j.company_id = ?")
        params.append(company_id)
    if q:
        where.append(f"(j.title {_LIKE} ? OR c.name {_LIKE} ? OR j.location {_LIKE} ?)")
        like = f"%{q}%"
        params += [like, like, like]
    sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY (j.state = 'new') DESC, j.first_seen_at DESC, j.id DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in _fetchall(sql, params)]


def get_company_job(job_id: int) -> dict | None:
    row = _fetchone("SELECT * FROM company_jobs WHERE id = ?", (job_id,))
    return dict(row) if row else None


def set_company_job_state(job_id: int, state: str) -> dict | None:
    _exec("UPDATE company_jobs SET state = ? WHERE id = ?", (state, job_id))
    return get_company_job(job_id)


def mark_company_jobs_seen() -> int:
    return _exec_rowcount("UPDATE company_jobs SET state = 'seen' WHERE state = 'new'")


def company_jobs_summary() -> dict:
    new_matched = _fetchone(
        "SELECT COUNT(*) AS n FROM company_jobs WHERE active = 1 AND matched = 1 AND state = 'new'")["n"]
    total_matched = _fetchone(
        "SELECT COUNT(*) AS n FROM company_jobs WHERE active = 1 AND matched = 1 AND state != 'dismissed'")["n"]
    companies = _fetchone("SELECT COUNT(*) AS n FROM companies")["n"]
    return {"new_matched": new_matched, "total_matched": total_matched,
            "companies": companies}
