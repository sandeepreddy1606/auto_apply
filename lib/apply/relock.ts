/**
 * Locking a resume to an application — shared by "Use this resume" and
 * "Use a PDF instead". Allowed before the fill and after it (reviewing,
 * needs input, blocked, failed): the open form still holds the old file, so
 * its page is closed and the next fill uploads the new one, keeping your answers.
 */
import { sql } from '@/lib/server/db'
import { HttpError } from '@/lib/server/http'
import { updateVersion } from '@/lib/resume/store'
import { enqueue } from '@/lib/tasks/queue'
import type { ApplySession } from '@/lib/types'

import { setStatus } from './sessions'

const BUSY = ['filling', 'submitting', 'submitted', 'cancelled', 'unconfirmed']

export function assertCanChangeResume(s: ApplySession): void {
  if (BUSY.includes(s.status)) {
    throw new HttpError(409, s.status === 'unconfirmed'
      ? 'First tell us whether the last submit went through.'
      : `Can't change the resume while this application is ${s.status.replace('_', ' ')}.`)
  }
}

export async function lockVersion(s: ApplySession, versionId: number, data: Record<string, unknown> = {}): Promise<ApplySession> {
  assertCanChangeResume(s)
  const filledBefore = Boolean(s.fill_plan?.fields.length)
  // Exactly one locked version per application.
  await sql.run("UPDATE resume_versions SET status = 'draft' WHERE session_id = ? AND status = 'locked'", [s.id])
  await updateVersion(versionId, { status: 'locked' })
  const next = await setStatus(s.id, 'resume_ready', { resume_version_id: versionId, error: null }, {
    type: 'resume.locked',
    actor: 'user',
    data: { version_id: versionId, ...data },
  })
  if (filledBefore) await enqueue('apply.cancel', { session_id: s.id })
  return next
}
