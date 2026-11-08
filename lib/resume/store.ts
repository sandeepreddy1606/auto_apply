/** Persistence for resume bases (with undo history), fact overlays and versions. */
import fs from 'node:fs'
import path from 'node:path'

import { parseJson, sql } from '@/lib/server/db'
import { DATA_DIR } from '@/lib/server/paths'
import type { FactBank, FactOverlay, ResumeBase, ResumeVersion } from '@/lib/types'

import { buildFacts, EMPTY_OVERLAY } from './facts'
import { parseResume } from './latex/parse'

export const VERSIONS_DIR = path.join(DATA_DIR, 'resumes', 'versions')
export const SEED_PATH = path.join(DATA_DIR, 'seed', 'base_resume.tex')

const now = () => new Date().toISOString()

function toBase(r: Record<string, unknown>): ResumeBase {
  return {
    id: Number(r.id),
    name: String(r.name),
    latex: String(r.latex),
    is_default: Number(r.is_default ?? 0),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }
}

/** First run: import data/seed/base_resume.tex as the default base, once. */
export async function ensureSeeded(): Promise<void> {
  const n = Number((await sql.one('SELECT COUNT(*) AS n FROM resume_bases'))?.n ?? 0)
  if (n > 0 || !fs.existsSync(SEED_PATH)) return
  const latex = fs.readFileSync(SEED_PATH, 'utf-8')
  await createBase('Base resume', latex, true)
}

export async function listBases(): Promise<ResumeBase[]> {
  await ensureSeeded()
  return (await sql.all('SELECT * FROM resume_bases ORDER BY is_default DESC, id')).map(toBase)
}

export async function getBase(id: number): Promise<ResumeBase | null> {
  const r = await sql.one('SELECT * FROM resume_bases WHERE id = ?', [id])
  return r ? toBase(r) : null
}

export async function getDefaultBase(): Promise<ResumeBase | null> {
  await ensureSeeded()
  const r = await sql.one('SELECT * FROM resume_bases ORDER BY is_default DESC, id LIMIT 1')
  return r ? toBase(r) : null
}

export async function createBase(name: string, latex: string, makeDefault = false): Promise<ResumeBase> {
  const count = Number((await sql.one('SELECT COUNT(*) AS n FROM resume_bases'))?.n ?? 0)
  const isDefault = makeDefault || count === 0
  if (isDefault) await sql.run('UPDATE resume_bases SET is_default = 0')
  const id = await sql.insert(
    'INSERT INTO resume_bases (name, latex, is_default, dismissed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name.slice(0, 80) || 'Base resume', latex, isDefault ? 1 : 0, '[]', now(), now()],
  )
  return (await getBase(id))!
}

export async function updateBaseLatex(id: number, latex: string, reason: string): Promise<ResumeBase> {
  const cur = await getBase(id)
  if (!cur) throw new Error('Base not found')
  if (cur.latex !== latex) {
    await sql.run('INSERT INTO resume_base_history (base_id, latex, reason, created_at) VALUES (?, ?, ?, ?)', [
      id,
      cur.latex,
      reason.slice(0, 200),
      now(),
    ])
    await sql.run('UPDATE resume_bases SET latex = ?, updated_at = ? WHERE id = ?', [latex, now(), id])
  }
  return (await getBase(id))!
}

export async function renameBase(id: number, name: string): Promise<void> {
  await sql.run('UPDATE resume_bases SET name = ?, updated_at = ? WHERE id = ?', [name.slice(0, 80), now(), id])
}

export async function setDefaultBase(id: number): Promise<void> {
  await sql.tx(async (b) => {
    await b.run('UPDATE resume_bases SET is_default = 0')
    await b.run('UPDATE resume_bases SET is_default = 1 WHERE id = ?', [id])
  })
}

export async function deleteBase(id: number): Promise<void> {
  await sql.run('DELETE FROM resume_bases WHERE id = ?', [id])
  await sql.run('DELETE FROM resume_base_history WHERE base_id = ?', [id])
  await sql.run('DELETE FROM fact_overlays WHERE base_id = ?', [id])
  const left = await sql.one('SELECT id FROM resume_bases ORDER BY is_default DESC, id LIMIT 1')
  if (left) await setDefaultBase(Number(left.id))
}

/** Restore the previous saved text of a base. Returns false when there's nothing to undo. */
export async function undoBase(id: number): Promise<{ ok: boolean; reason: string | null }> {
  const h = await sql.one('SELECT * FROM resume_base_history WHERE base_id = ? ORDER BY id DESC LIMIT 1', [id])
  if (!h) return { ok: false, reason: null }
  await sql.run('UPDATE resume_bases SET latex = ?, updated_at = ? WHERE id = ?', [String(h.latex), now(), id])
  await sql.run('DELETE FROM resume_base_history WHERE id = ?', [Number(h.id)])
  return { ok: true, reason: (h.reason as string) ?? null }
}

export async function historyCount(id: number): Promise<number> {
  return Number((await sql.one('SELECT COUNT(*) AS n FROM resume_base_history WHERE base_id = ?', [id]))?.n ?? 0)
}

export async function getDismissed(id: number): Promise<string[]> {
  const r = await sql.one('SELECT dismissed FROM resume_bases WHERE id = ?', [id])
  return parseJson<string[]>(r?.dismissed) ?? []
}

export async function addDismissed(id: number, issueId: string): Promise<void> {
  const cur = new Set(await getDismissed(id))
  cur.add(issueId)
  await sql.run('UPDATE resume_bases SET dismissed = ? WHERE id = ?', [JSON.stringify([...cur]), id])
}

export async function getOverlay(baseId: number): Promise<FactOverlay> {
  const r = await sql.one('SELECT data FROM fact_overlays WHERE base_id = ?', [baseId])
  return { ...EMPTY_OVERLAY, ...(parseJson<FactOverlay>(r?.data) ?? {}) }
}

export async function saveOverlay(baseId: number, overlay: FactOverlay): Promise<void> {
  const data = JSON.stringify(overlay)
  const exists = await sql.one('SELECT base_id FROM fact_overlays WHERE base_id = ?', [baseId])
  if (exists) await sql.run('UPDATE fact_overlays SET data = ?, updated_at = ? WHERE base_id = ?', [data, now(), baseId])
  else await sql.run('INSERT INTO fact_overlays (base_id, data, updated_at) VALUES (?, ?, ?)', [baseId, data, now()])
}

export async function factsForBase(base: ResumeBase): Promise<FactBank> {
  return buildFacts(parseResume(base.latex), await getOverlay(base.id))
}

export async function getDefaultFacts(): Promise<FactBank | null> {
  const b = await getDefaultBase()
  return b ? factsForBase(b) : null
}

// ---------- versions ----------

const VERSION_JSON = ['ats_report', 'guard_report', 'compile_log', 'llm_plan'] as const

function toVersion(r: Record<string, unknown>): ResumeVersion & { llm_plan: unknown } {
  const out = { ...r } as Record<string, unknown>
  for (const k of VERSION_JSON) out[k] = parseJson(r[k])
  for (const k of ['id', 'base_id', 'parent_id', 'job_id', 'session_id', 'page_count', 'llm_call_id']) {
    out[k] = r[k] == null ? null : Number(r[k])
  }
  return out as unknown as ResumeVersion & { llm_plan: unknown }
}

export async function createVersion(fields: {
  base_id: number
  parent_id?: number | null
  job_id?: number | null
  session_id?: number | null
  latex: string
  generated_by: ResumeVersion['generated_by']
  status?: ResumeVersion['status']
  hint?: string | null
}): Promise<number> {
  return sql.insert(
    'INSERT INTO resume_versions (base_id, parent_id, job_id, session_id, latex, generated_by, status, hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      fields.base_id,
      fields.parent_id ?? null,
      fields.job_id ?? null,
      fields.session_id ?? null,
      fields.latex,
      fields.generated_by,
      fields.status ?? 'draft',
      fields.hint ?? null,
      now(),
    ],
  )
}

export async function getVersion(id: number): Promise<(ResumeVersion & { llm_plan: unknown }) | null> {
  const r = await sql.one('SELECT * FROM resume_versions WHERE id = ?', [id])
  return r ? toVersion(r) : null
}

export async function updateVersion(id: number, fields: Record<string, unknown>): Promise<void> {
  const allowed = ['latex', 'pdf_path', 'page_count', 'ats_report', 'guard_report', 'compile_log', 'llm_plan', 'llm_call_id', 'status', 'error', 'generated_by']
  const keys = Object.keys(fields).filter((k) => allowed.includes(k))
  if (!keys.length) return
  const vals = keys.map((k) => {
    const v = fields[k]
    return v != null && typeof v === 'object' ? JSON.stringify(v) : (v as string | number | null)
  })
  await sql.run(`UPDATE resume_versions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...vals, id])
}

export async function listVersionsForSession(sessionId: number): Promise<ResumeVersion[]> {
  return (await sql.all('SELECT * FROM resume_versions WHERE session_id = ? ORDER BY id DESC', [sessionId])).map(toVersion)
}

/** Earlier locked versions for other jobs, newest first (for "reuse" suggestions). */
export async function lockedVersions(excludeSession: number, limit = 30): Promise<(ResumeVersion & { job_title: string; company_name: string; description_text: string | null })[]> {
  const rows = await sql.all(
    `SELECT v.*, j.title AS job_title, c.name AS company_name, j.description_text
     FROM resume_versions v JOIN company_jobs j ON j.id = v.job_id JOIN companies c ON c.id = j.company_id
     WHERE v.status = 'locked' AND (v.session_id IS NULL OR v.session_id != ?) ORDER BY v.id DESC LIMIT ?`,
    [excludeSession, limit],
  )
  return rows.map((r) => ({
    ...toVersion(r),
    job_title: String(r.job_title),
    company_name: String(r.company_name),
    description_text: (r.description_text as string) ?? null,
  }))
}

export function pdfPathFor(versionId: number): string {
  return path.join(VERSIONS_DIR, String(versionId), 'resume.pdf')
}

export function writeVersionFiles(versionId: number, latex: string, pdf: Buffer | null, log: string): string | null {
  const dir = path.join(VERSIONS_DIR, String(versionId))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'main.tex'), latex, 'utf-8')
  fs.writeFileSync(path.join(dir, 'build.log'), log, 'utf-8')
  if (!pdf) return null
  const p = path.join(dir, 'resume.pdf')
  fs.writeFileSync(p, pdf)
  return p
}
