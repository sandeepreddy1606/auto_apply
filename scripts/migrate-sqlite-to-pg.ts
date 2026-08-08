/**
 * One-time migration: copy applications/companies/company_jobs from the local
 * SQLite database into the Postgres database configured via DATABASE_URL (.env).
 *
 * Safe to run more than once — rows that already exist (same id or unique key)
 * are skipped.
 *
 *   npm run migrate:pg
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'

import pg from 'pg'

import { DATABASE_URL } from '../lib/server/env.ts'
import { DB_PATH } from '../lib/server/paths.ts'
import * as db from '../lib/server/db.ts'

const TABLES = ['applications', 'companies', 'company_jobs'] as const

async function main(): Promise<void> {
  if (!db.IS_PG) {
    console.error(
      'DATABASE_URL is not a Postgres URL — nothing to migrate into. Set it in .env first.',
    )
    process.exit(1)
  }
  if (!fs.existsSync(DB_PATH)) {
    console.log(`No SQLite database at ${DB_PATH} — nothing to migrate.`)
    return
  }

  // Touching the app's data layer first creates the Postgres schema if needed.
  await db.listCompanies()

  const sq = new DatabaseSync(DB_PATH, { readOnly: true })
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })

  try {
    for (const table of TABLES) {
      let rows: Record<string, unknown>[]
      try {
        rows = sq.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      } catch {
        console.log(`${table}: not present in SQLite, skipping`)
        continue
      }
      if (rows.length === 0) {
        console.log(`${table}: 0 rows`)
        continue
      }

      // Only copy columns Postgres actually has, so a stale SQLite file with an
      // extra column can't abort the run.
      const { rows: colRows } = await pool.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [table],
      )
      const pgCols = new Set(colRows.map((r) => r.column_name))

      let inserted = 0
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => pgCols.has(c))
        if (cols.length === 0) continue
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
        const res = await pool.query(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          cols.map((c) => row[c]),
        )
        inserted += res.rowCount ?? 0
      }

      // Keep SERIAL sequences ahead of the copied ids.
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), ` +
          `(SELECT COALESCE(MAX(id), 1) FROM ${table}))`,
      )
      console.log(`${table}: ${inserted} inserted (${rows.length} in SQLite)`)
    }
    console.log('Done.')
  } finally {
    sq.close()
    await pool.end()
  }
}

await main()
