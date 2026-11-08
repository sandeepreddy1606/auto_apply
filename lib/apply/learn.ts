/**
 * Learning loop: answers you type or correct during review become reusable.
 *   question → answer        (answer_bank)
 *   field signature → key    (field_mappings, when the value equals a profile field)
 */
import { sql } from '@/lib/server/db'
import type { AnswerBankEntry, FormField, Profile } from '@/lib/types'

import { fieldSig, normQuestion, PROFILE_RULES } from './resolve'
import type { ResolveContext } from './resolve'

const now = () => new Date().toISOString()

export async function loadBank(): Promise<ResolveContext['bank']> {
  const rows = await sql.all('SELECT question_norm, answer, field_type FROM answer_bank ORDER BY uses DESC, id DESC LIMIT 2000')
  return rows.map((r) => ({ question_norm: String(r.question_norm), answer: String(r.answer), field_type: String(r.field_type) }))
}

export async function loadMappings(atsType: string): Promise<ResolveContext['mappings']> {
  const rows = await sql.all('SELECT field_sig, profile_key FROM field_mappings WHERE ats_type = ? ORDER BY uses DESC', [atsType])
  return rows.map((r) => ({ field_sig: String(r.field_sig), profile_key: String(r.profile_key) }))
}

export async function rememberAnswer(field: FormField, answer: string, atsType: string): Promise<void> {
  const q = normQuestion(field.label)
  if (!q || !answer.trim() || field.kind === 'file') return
  const existing = await sql.one('SELECT id FROM answer_bank WHERE question_norm = ?', [q])
  if (existing) {
    await sql.run('UPDATE answer_bank SET answer = ?, field_type = ?, uses = uses + 1, last_used_at = ? WHERE id = ?', [
      answer,
      field.kind,
      now(),
      Number(existing.id),
    ])
  } else {
    await sql.insert(
      'INSERT INTO answer_bank (question_norm, question_raw, answer, field_type, ats_type, uses, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      [q, field.label.slice(0, 400), answer, field.kind, atsType, now(), now()],
    )
  }
}

/** If the value you typed equals one of your profile fields, remember that mapping for this ATS. */
export async function rememberMapping(field: FormField, answer: string, atsType: string, profile: Partial<Profile>): Promise<void> {
  const v = answer.trim().toLowerCase()
  if (!v) return
  const ctx = { profile } as ResolveContext
  for (const [, key, get] of PROFILE_RULES) {
    if (!get) continue
    if ((get(ctx) || '').trim().toLowerCase() === v) {
      const sig = fieldSig(field)
      const ex = await sql.one('SELECT id FROM field_mappings WHERE ats_type = ? AND field_sig = ?', [atsType, sig])
      if (ex) await sql.run('UPDATE field_mappings SET profile_key = ?, uses = uses + 1, last_used_at = ? WHERE id = ?', [key, now(), Number(ex.id)])
      else
        await sql.insert('INSERT INTO field_mappings (ats_type, field_sig, label_norm, profile_key, uses, last_used_at) VALUES (?, ?, ?, ?, 1, ?)', [
          atsType,
          sig,
          normQuestion(field.label),
          key,
          now(),
        ])
      return
    }
  }
}

export async function bumpUses(questionNorms: string[]): Promise<void> {
  for (const q of questionNorms) {
    await sql.run('UPDATE answer_bank SET uses = uses + 1, last_used_at = ? WHERE question_norm = ?', [now(), q])
  }
}

// ---------- CRUD for Settings → Application answers → Learned answers ----------

function toEntry(r: Record<string, unknown>): AnswerBankEntry {
  return {
    id: Number(r.id),
    question_raw: String(r.question_raw),
    question_norm: String(r.question_norm),
    answer: String(r.answer),
    field_type: String(r.field_type),
    ats_type: (r.ats_type as string) ?? null,
    uses: Number(r.uses ?? 0),
    last_used_at: (r.last_used_at as string) ?? null,
    created_at: String(r.created_at),
  }
}

export async function listBank(q?: string | null): Promise<AnswerBankEntry[]> {
  const rows = q
    ? await sql.all(`SELECT * FROM answer_bank WHERE question_raw ${sql.LIKE} ? OR answer ${sql.LIKE} ? ORDER BY uses DESC, id DESC LIMIT 500`, [`%${q}%`, `%${q}%`])
    : await sql.all('SELECT * FROM answer_bank ORDER BY uses DESC, id DESC LIMIT 500')
  return rows.map(toEntry)
}

export async function addBankEntry(question: string, answer: string): Promise<AnswerBankEntry> {
  const id = await sql.insert(
    'INSERT INTO answer_bank (question_norm, question_raw, answer, field_type, ats_type, uses, created_at) VALUES (?, ?, ?, ?, NULL, 0, ?)',
    [normQuestion(question), question.slice(0, 400), answer, 'text', now()],
  )
  return toEntry((await sql.one('SELECT * FROM answer_bank WHERE id = ?', [id]))!)
}

export async function updateBankEntry(id: number, fields: { question?: string; answer?: string }): Promise<void> {
  if (fields.question != null) {
    await sql.run('UPDATE answer_bank SET question_raw = ?, question_norm = ? WHERE id = ?', [fields.question, normQuestion(fields.question), id])
  }
  if (fields.answer != null) await sql.run('UPDATE answer_bank SET answer = ? WHERE id = ?', [fields.answer, id])
}

export async function deleteBankEntry(id: number): Promise<void> {
  await sql.run('DELETE FROM answer_bank WHERE id = ?', [id])
}

export async function bankStats(): Promise<{ answers: number; mappings: number }> {
  const a = Number((await sql.one('SELECT COUNT(*) AS n FROM answer_bank'))?.n ?? 0)
  const m = Number((await sql.one('SELECT COUNT(*) AS n FROM field_mappings'))?.n ?? 0)
  return { answers: a, mappings: m }
}
