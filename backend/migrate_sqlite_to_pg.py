"""One-time migration: copy applications/companies/company_jobs from the local
SQLite database into the Postgres database configured via DATABASE_URL (.env).

Safe to run more than once — rows that already exist (same id or unique key) are
skipped. Run:  python migrate_sqlite_to_pg.py
"""
import os
import sqlite3
import sys

from app import config, database as db
from app.paths import DB_PATH

TABLES = ["applications", "companies", "company_jobs"]


def main():
    if not db.IS_PG:
        print("DATABASE_URL is not a Postgres URL — nothing to migrate into. "
              "Set it in .env first.")
        sys.exit(1)
    if not os.path.exists(DB_PATH):
        print(f"No SQLite database at {DB_PATH} — nothing to migrate.")
        return

    sq = sqlite3.connect(DB_PATH)
    sq.row_factory = sqlite3.Row
    db._get_conn()  # ensures Postgres schema exists

    for table in TABLES:
        try:
            rows = sq.execute(f"SELECT * FROM {table}").fetchall()
        except sqlite3.OperationalError:
            print(f"{table}: not present in SQLite, skipping")
            continue
        if not rows:
            print(f"{table}: 0 rows")
            continue

        with db._lock:
            conn = db._get_conn()
            pg_cols = {r["column_name"] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
                (table,)).fetchall()}

        inserted = 0
        for row in rows:
            data = {k: row[k] for k in row.keys() if k in pg_cols}
            cols = list(data.keys())
            sql = (f"INSERT INTO {table} ({', '.join(cols)}) "
                   f"VALUES ({', '.join(['%s'] * len(cols))}) ON CONFLICT DO NOTHING")
            with db._lock:
                conn = db._get_conn()
                cur = conn.execute(sql, [data[c] for c in cols])
                inserted += cur.rowcount
                conn.commit()
        # keep SERIAL sequences ahead of the copied ids
        with db._lock:
            conn = db._get_conn()
            conn.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"(SELECT COALESCE(MAX(id), 1) FROM {table}))")
            conn.commit()
        print(f"{table}: {inserted} inserted ({len(rows)} in SQLite)")

    sq.close()
    print("Done.")


if __name__ == "__main__":
    main()
