/**
 * Apply sessions: one per (job, attempt). Holds the locked resume version, the
 * fill plan and status; every change is mirrored as an application_events row
 * so the UI timeline and live stream are built from one source.
 */
import fs from 'node:fs'
import path from 'node:path'

import { parseJson, sql } from '@/lib/server/db'
import { DATA_DIR } from '@/lib/server/paths'
import type { AppStage, ApplySession, FillPlan, SessionArtifact, SessionEvent, SessionStatus } from '@/lib/types'

export const ARTIFACTS_DIR = path.join(DATA_DIR, 'apply')

const now = () => new Date().toISOString()

function toSession(r: Record<string, unknown>): ApplySession {
  return {
    id: Number(r.id),
    job_id: Number(r.job_id),
    resume_version_id: r.resume_version_id == null ? null : Number(r.resume_version_id),
    status: String(r.status) as SessionStatus,
    ats_type: (r.ats_type as string) ?? null,
    apply_url: (r.apply_url as string) ?? null,
    fill_plan: parseJson<FillPlan>(r.fill_plan),
    jd_snapshot: (r.jd_snapshot as string) ?? null,
    error: (r.error as string) ?? null,
    stage: (r.stage as AppStage) ?? null,
    stage_updated_at: (r.stage_updated_at as string) ?? null,
    notes: (r.notes as string) ?? null,
    started_at: String(r.started_at),
    submitted_at: (r.submitted_at as string) ?? null,
    updated_at: String(r.updated_at),
  }
}

export async function createSession(fields: {
  job_id: number
  ats_type: string | null
  apply_url: string
  jd_snapshot: string | null
}): Promise<number> {
  const id = await sql.insert(
    "INSERT INTO apply_sessions (job_id, status, ats_type, apply_url, jd_snapshot, started_at, updated_at) VALUES (?, 'created', ?, ?, ?, ?, ?)",
    [fields.job_id, fields.ats_type, fields.apply_url, fields.jd_snapshot, now(), now()],
  )
  await addEvent(id, 'session.created', 'user', { apply_url: fields.apply_url })
  return id
}

export async function getSession(id: number): Promise<ApplySession | null> {
  const r = await sql.one('SELECT * FROM apply_sessions WHERE id = ?', [id])
  return r ? toSession(r) : null
}

/** Valid status moves; anything else is refused so the state machine stays honest. */
const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  created: ['resume_drafting', 'resume_ready', 'cancelled'],
  resume_drafting: ['resume_drafting', 'resume_ready', 'cancelled', 'failed'],
  resume_ready: ['resume_drafting', 'filling', 'cancelled'],
  filling: ['reviewing', 'needs_input', 'blocked', 'failed', 'cancelled', 'filling'],
  needs_input: ['reviewing', 'needs_input', 'filling', 'cancelled', 'resume_drafting', 'failed'],
  reviewing: ['reviewing', 'needs_input', 'submitting', 'filling', 'cancelled', 'resume_drafting', 'failed'],
  blocked: ['filling', 'reviewing', 'needs_input', 'cancelled', 'failed'],
  submitting: ['submitted', 'unconfirmed', 'failed', 'reviewing', 'needs_input'],
  unconfirmed: ['submitted', 'reviewing', 'cancelled'],
  submitted: [],
  failed: ['filling', 'resume_drafting', 'resume_ready', 'cancelled'],
  cancelled: [],
}

export function canMove(from: SessionStatus, to: SessionStatus): boolean {
  return from === to || TRANSITIONS[from]?.includes(to)
}

export class TransitionError extends Error {}

export async function setStatus(
  id: number,
  to: SessionStatus,
  extra: { error?: string | null; fill_plan?: FillPlan | null; resume_version_id?: number | null; submitted_at?: string | null } = {},
  event?: { type: string; actor?: 'user' | 'system'; data?: Record<string, unknown> },
): Promise<ApplySession> {
  const s = await getSession(id)
  if (!s) throw new TransitionError('Session not found')
  if (!canMove(s.status, to)) throw new TransitionError(`Can't go from ${s.status} to ${to}`)
  const sets = ['status = ?', 'updated_at = ?']
  const vals: (string | number | null)[] = [to, now()]
  if ('error' in extra) {
    sets.push('error = ?')
    vals.push(extra.error ?? null)
  }
  if ('fill_plan' in extra) {
    sets.push('fill_plan = ?')
    vals.push(extra.fill_plan ? JSON.stringify(extra.fill_plan) : null)
  }
  if ('resume_version_id' in extra) {
    sets.push('resume_version_id = ?')
    vals.push(extra.resume_version_id ?? null)
  }
  if ('submitted_at' in extra) {
    sets.push('submitted_at = ?')
    vals.push(extra.submitted_at ?? null)
  }
  await sql.run(`UPDATE apply_sessions SET ${sets.join(', ')} WHERE id = ?`, [...vals, id])
  await addEvent(id, event?.type ?? `status.${to}`, event?.actor ?? 'system', { from: s.status, to, ...(event?.data ?? {}), ...(extra.error ? { error: extra.error } : {}) })
  return (await getSession(id))!
}

export async function savePlan(id: number, plan: FillPlan): Promise<void> {
  await sql.run('UPDATE apply_sessions SET fill_plan = ?, updated_at = ? WHERE id = ?', [JSON.stringify(plan), now(), id])
}

export async function setStage(id: number, stage: AppStage, notes?: string | null): Promise<void> {
  await sql.run('UPDATE apply_sessions SET stage = ?, stage_updated_at = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?', [
    stage,
    now(),
    notes ?? null,
    now(),
    id,
  ])
  await addEvent(id, 'stage.changed', 'user', { stage })
}

export async function addEvent(sessionId: number, type: string, actor: 'user' | 'system', data: Record<string, unknown> | null = null): Promise<number> {
  return sql.insert('INSERT INTO application_events (session_id, type, actor, data, at) VALUES (?, ?, ?, ?, ?)', [
    sessionId,
    type,
    actor,
    data ? JSON.stringify(data) : null,
    now(),
  ])
}

export async function eventsSince(sessionId: number, afterId = 0): Promise<SessionEvent[]> {
  const rows = await sql.all('SELECT * FROM application_events WHERE session_id = ? AND id > ? ORDER BY id LIMIT 200', [sessionId, afterId])
  return rows.map((r) => ({
    id: Number(r.id),
    session_id: Number(r.session_id),
    type: String(r.type),
    actor: String(r.actor) as 'user' | 'system',
    data: parseJson<Record<string, unknown>>(r.data),
    at: String(r.at),
  }))
}

export async function addArtifact(sessionId: number, kind: string, buf: Buffer, step: number | null, ext = 'png'): Promise<number> {
  const dir = path.join(ARTIFACTS_DIR, String(sessionId))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${kind}-${Date.now()}.${ext}`)
  fs.writeFileSync(file, buf)
  const id = await sql.insert('INSERT INTO artifacts (session_id, kind, path, step, at) VALUES (?, ?, ?, ?, ?)', [sessionId, kind, file, step, now()])
  await addEvent(sessionId, 'artifact.added', 'system', { artifact_id: id, kind, step })
  return id
}

export async function listArtifacts(sessionId: number): Promise<SessionArtifact[]> {
  const rows = await sql.all('SELECT id, session_id, kind, step, at FROM artifacts WHERE session_id = ? ORDER BY id', [sessionId])
  return rows.map((r) => ({ id: Number(r.id), session_id: Number(r.session_id), kind: String(r.kind), step: r.step == null ? null : Number(r.step), at: String(r.at) }))
}

export async function getArtifact(id: number): Promise<{ path: string; session_id: number; kind: string } | null> {
  const r = await sql.one('SELECT path, session_id, kind FROM artifacts WHERE id = ?', [id])
  return r ? { path: String(r.path), session_id: Number(r.session_id), kind: String(r.kind) } : null
}

/** Applications tracker: sessions with job + company, newest first. */
export async function listSessions(opts: { status?: string | null; limit?: number } = {}): Promise<
  (ApplySession & { job_title: string; company_name: string; job_url: string })[]
> {
  const where: string[] = []
  const params: (string | number)[] = []
  if (opts.status) {
    where.push('s.status = ?')
    params.push(opts.status)
  }
  const rows = await sql.all(
    `SELECT s.*, j.title AS job_title, c.name AS company_name, j.url AS job_url
     FROM apply_sessions s JOIN company_jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.id DESC LIMIT ?`,
    [...params, opts.limit ?? 300],
  )
  return rows.map((r) => ({ ...toSession(r), job_title: String(r.job_title), company_name: String(r.company_name), job_url: String(r.job_url) }))
}

/** Submissions today (daily cap) and recent applications to the same company (duplicate warning). */
export async function submittedToday(): Promise<number> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  return Number((await sql.one("SELECT COUNT(*) AS n FROM apply_sessions WHERE status = 'submitted' AND submitted_at >= ?", [since.toISOString()]))?.n ?? 0)
}

export async function recentForCompany(companyId: number, days: number, excludeJob: number): Promise<{ job_title: string; submitted_at: string }[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const rows = await sql.all(
    `SELECT j.title AS job_title, s.submitted_at FROM apply_sessions s JOIN company_jobs j ON j.id = s.job_id
     WHERE j.company_id = ? AND s.status = 'submitted' AND s.submitted_at >= ? AND j.id != ? ORDER BY s.submitted_at DESC`,
    [companyId, cutoff, excludeJob],
  )
  return rows.map((r) => ({ job_title: String(r.job_title), submitted_at: String(r.submitted_at) }))
}
