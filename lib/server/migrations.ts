/**
 * Numbered schema migrations for the career-page apply flow.
 *
 * Each migration runs once, inside the same driver the app uses, and is
 * recorded in `schema_migrations`. They're written to work on both SQLite and
 * Postgres: JSON is stored as TEXT, ids use the backend's auto-increment, and
 * column additions go through `addColumn`, which is idempotent on both.
 */

type Param = string | number | null
type Row = Record<string, unknown>

export interface MigrationDriver {
  all(sql: string, params?: Param[]): Promise<Row[]>
  run(sql: string, params?: Param[]): Promise<number>
}

interface Ctx {
  d: MigrationDriver
  pg: boolean
  pk: string
}

async function addColumn(ctx: Ctx, table: string, column: string, type: string): Promise<void> {
  if (ctx.pg) {
    await ctx.d.run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`)
    return
  }
  const cols = await ctx.d.all(`PRAGMA table_info(${table})`)
  if (!cols.some((c) => c.name === column)) {
    await ctx.d.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

const MIGRATIONS: { id: number; name: string; up: (ctx: Ctx) => Promise<void> }[] = [
  {
    id: 1,
    name: 'jobs: descriptions, scoring, ATS metadata',
    async up(ctx) {
      for (const [col, type] of [
        ['ats_type', 'TEXT'],
        ['ats_token', 'TEXT'],
        ['priority', "TEXT DEFAULT 'normal'"],
      ] as const) {
        await addColumn(ctx, 'companies', col, type)
      }
      for (const [col, type] of [
        ['description_html', 'TEXT'],
        ['description_text', 'TEXT'],
        ['posted_at', 'TEXT'],
        ['ats_job_id', 'TEXT'],
        ['apply_url', 'TEXT'],
        ['match_score', 'INTEGER'],
        ['match_breakdown', 'TEXT'],
        ['jd_fetched_at', 'TEXT'],
        ['jd_error', 'TEXT'],
      ] as const) {
        await addColumn(ctx, 'company_jobs', col, type)
      }
      await ctx.d.run(
        'CREATE INDEX IF NOT EXISTS idx_company_jobs_score ON company_jobs(match_score)',
      )
    },
  },
  {
    id: 2,
    name: 'task queue + key/value',
    async up({ d, pk }) {
      await d.run(`CREATE TABLE IF NOT EXISTS tasks (
        id ${pk},
        type TEXT NOT NULL,
        lane TEXT NOT NULL DEFAULT 'default',
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        dedupe_key TEXT,
        run_after TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        locked_by TEXT,
        locked_at TEXT,
        last_error TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`)
      await d.run('CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks(status, lane, run_after)')
      await d.run('CREATE INDEX IF NOT EXISTS idx_tasks_dedupe ON tasks(dedupe_key, status)')
      await d.run(`CREATE TABLE IF NOT EXISTS kv (
        k TEXT PRIMARY KEY,
        v TEXT,
        updated_at TEXT NOT NULL
      )`)
    },
  },
  {
    id: 3,
    name: 'resume bases, fact overlay, versions',
    async up({ d, pk }) {
      await d.run(`CREATE TABLE IF NOT EXISTS resume_bases (
        id ${pk},
        name TEXT NOT NULL,
        latex TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        dismissed TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`)
      await d.run(`CREATE TABLE IF NOT EXISTS resume_base_history (
        id ${pk},
        base_id INTEGER NOT NULL,
        latex TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      )`)
      await d.run(`CREATE TABLE IF NOT EXISTS fact_overlays (
        base_id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`)
      await d.run(`CREATE TABLE IF NOT EXISTS resume_versions (
        id ${pk},
        base_id INTEGER NOT NULL,
        parent_id INTEGER,
        job_id INTEGER,
        session_id INTEGER,
        latex TEXT NOT NULL,
        pdf_path TEXT,
        page_count INTEGER,
        ats_report TEXT,
        guard_report TEXT,
        compile_log TEXT,
        llm_plan TEXT,
        llm_call_id INTEGER,
        generated_by TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'draft',
        hint TEXT,
        error TEXT,
        created_at TEXT NOT NULL
      )`)
      await d.run(
        'CREATE INDEX IF NOT EXISTS idx_resume_versions_session ON resume_versions(session_id)',
      )
    },
  },
  {
    id: 4,
    name: 'apply sessions, events, artifacts',
    async up({ d, pk }) {
      await d.run(`CREATE TABLE IF NOT EXISTS apply_sessions (
        id ${pk},
        job_id INTEGER NOT NULL,
        resume_version_id INTEGER,
        status TEXT NOT NULL DEFAULT 'created',
        ats_type TEXT,
        apply_url TEXT,
        fill_plan TEXT,
        jd_snapshot TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        stage TEXT,
        stage_updated_at TEXT,
        notes TEXT,
        started_at TEXT NOT NULL,
        submitted_at TEXT,
        updated_at TEXT NOT NULL
      )`)
      await d.run('CREATE INDEX IF NOT EXISTS idx_apply_sessions_job ON apply_sessions(job_id)')
      await d.run(`CREATE TABLE IF NOT EXISTS application_events (
        id ${pk},
        session_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        data TEXT,
        at TEXT NOT NULL
      )`)
      await d.run(
        'CREATE INDEX IF NOT EXISTS idx_events_session ON application_events(session_id, id)',
      )
      await d.run(`CREATE TABLE IF NOT EXISTS artifacts (
        id ${pk},
        session_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        step INTEGER,
        at TEXT NOT NULL
      )`)
    },
  },
  {
    id: 5,
    name: 'learning: answer bank, field mappings; llm call log',
    async up({ d, pk }) {
      await d.run(`CREATE TABLE IF NOT EXISTS answer_bank (
        id ${pk},
        question_norm TEXT NOT NULL,
        question_raw TEXT NOT NULL,
        answer TEXT NOT NULL,
        field_type TEXT NOT NULL DEFAULT 'text',
        ats_type TEXT,
        uses INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL
      )`)
      await d.run('CREATE INDEX IF NOT EXISTS idx_answer_bank_q ON answer_bank(question_norm)')
      await d.run(`CREATE TABLE IF NOT EXISTS field_mappings (
        id ${pk},
        ats_type TEXT NOT NULL,
        field_sig TEXT NOT NULL,
        label_norm TEXT NOT NULL,
        profile_key TEXT NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT
      )`)
      await d.run(
        'CREATE INDEX IF NOT EXISTS idx_field_mappings_sig ON field_mappings(ats_type, field_sig)',
      )
      await d.run(`CREATE TABLE IF NOT EXISTS llm_calls (
        id ${pk},
        provider TEXT NOT NULL,
        purpose TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        prompt TEXT,
        system_prompt TEXT,
        schema TEXT,
        output TEXT,
        status TEXT NOT NULL DEFAULT 'done',
        ok INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        error TEXT,
        at TEXT NOT NULL
      )`)
      await d.run('CREATE INDEX IF NOT EXISTS idx_llm_calls_hash ON llm_calls(input_hash)')
    },
  },
  {
    id: 6,
    name: 'accounts: users, sessions, one-time codes',
    async up({ d, pk }) {
      await d.run(`CREATE TABLE IF NOT EXISTS users (
        id ${pk},
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        recovery_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        password_changed_at TEXT,
        last_login_at TEXT
      )`)
      await d.run(`CREATE TABLE IF NOT EXISTS sessions (
        id ${pk},
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        remember INTEGER NOT NULL DEFAULT 0,
        user_agent TEXT,
        ip TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`)
      await d.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)')
      await d.run(`CREATE TABLE IF NOT EXISTS auth_codes (
        id ${pk},
        user_id INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      )`)
      await d.run('CREATE INDEX IF NOT EXISTS idx_auth_codes_user ON auth_codes(user_id, purpose)')
    },
  },
  {
    id: 7,
    name: 'companies: pause, scan scheduling and backoff',
    async up({ d }) {
      // paused: never scanned automatically; fail_count drives backoff;
      // next_scan_at is when the scheduler queues it next; scan_state is
      // 'queued' | 'scanning' | NULL so the page can show progress.
      for (const col of ['paused INTEGER NOT NULL DEFAULT 0', 'fail_count INTEGER NOT NULL DEFAULT 0', 'next_scan_at TEXT', 'scan_state TEXT']) {
        try {
          await d.run(`ALTER TABLE companies ADD COLUMN ${col}`)
        } catch {
          /* column exists (re-run) */
        }
      }
      try {
        await d.run('CREATE INDEX IF NOT EXISTS idx_company_jobs_title ON company_jobs(company_id, title)')
      } catch {
        /* optional */
      }
    },
  },
  {
    id: 8,
    name: 'jobs: filterable details read from each description',
    async up({ d }) {
      // Written when a job is scored (lib/jobs/store.ts rescoreJobs), so the
      // Jobs filters are plain column lookups.
      for (const col of [
        'exp_min REAL', 'exp_max REAL', 'work_mode TEXT', 'employment_type TEXT', 'seniority TEXT',
        'edu_level TEXT', 'skills TEXT', 'city TEXT', 'country TEXT', 'has_salary INTEGER', 'visa TEXT',
      ]) {
        try {
          await d.run(`ALTER TABLE company_jobs ADD COLUMN ${col}`)
        } catch {
          /* column exists (re-run) */
        }
      }
    },
  },
  {
    id: 9,
    name: 'telegram posts: message origin and career-page apply runs',
    async up({ d }) {
      // A Telegram post keeps where it came from (group, message, when it was
      // posted) and, for career-page links, the browser run that applies it.
      // That run is an apply_sessions row tied to the post (post_id) instead of
      // a scanned job, so Telegram jobs never show up in the career-page lists.
      const add = async (table: string, col: string) => {
        try {
          await d.run(`ALTER TABLE ${table} ADD COLUMN ${col}`)
        } catch {
          /* column exists (re-run) */
        }
      }
      for (const col of ['posted_at TEXT', 'tg_chat_id TEXT', 'tg_message_id INTEGER', 'session_id INTEGER']) await add('applications', col)
      await add('apply_sessions', 'post_id INTEGER')
      try {
        await d.run('CREATE INDEX IF NOT EXISTS idx_apply_sessions_post ON apply_sessions(post_id)')
      } catch {
        /* optional */
      }
    },
  },
  {
    id: 10,
    name: 'telegram posts: which file goes into each Google Form upload question',
    async up({ d }) {
      try {
        await d.run('ALTER TABLE applications ADD COLUMN form_files TEXT')
      } catch {
        /* column exists (re-run) */
      }
    },
  },
]

export async function runMigrations(d: MigrationDriver, pg: boolean): Promise<number[]> {
  const pk = pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'
  await d.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const done = new Set((await d.all('SELECT id FROM schema_migrations')).map((r) => Number(r.id)))
  const applied: number[] = []
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue
    await m.up({ d, pg, pk })
    // '?' placeholders: the app's driver translates them for postgres.
    await d.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [
      m.id,
      m.name,
      new Date().toISOString(),
    ])
    applied.push(m.id)
  }
  return applied
}

export const MIGRATION_COUNT = MIGRATIONS.length
