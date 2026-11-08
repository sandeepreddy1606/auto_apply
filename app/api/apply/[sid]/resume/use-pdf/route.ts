import fs from 'node:fs'
import path from 'node:path'

import { getSession, setStatus } from '@/lib/apply/sessions'
import { createVersion, getDefaultBase, pdfPathFor, updateVersion } from '@/lib/resume/store'
import { sql } from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import { listResumes, pathFor } from '@/lib/server/resumes'

export const dynamic = 'force-dynamic'

/** PDFs from Settings → Resumes that can be attached as-is. */
export const GET = handler(async () => {
  const items = listResumes()
    .filter((r) => /\.pdf$/i.test(r.stored))
    .map((r) => ({ id: r.id, name: r.name || r.original, original: r.original, size_kb: r.size_kb, is_default: r.is_default, exists: Boolean(pathFor(r.id)) }))
  return json({ items })
})

/**
 * "Use a PDF instead": attach a ready-made PDF from Settings → Resumes to this
 * application. Needs no LaTeX compiler, so you can apply before installing MiKTeX.
 */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ sid: string }> }) => {
  const sid = intParam((await ctx.params).sid)
  const s = await getSession(sid)
  if (!s) throw new HttpError(404, 'Application not found')
  if (['filling', 'submitting', 'submitted', 'cancelled'].includes(s.status)) {
    throw new HttpError(409, `Can't change the resume while ${s.status.replace('_', ' ')}.`)
  }
  const { resume_id } = await readJson<{ resume_id?: string }>(req)
  const src = resume_id ? pathFor(String(resume_id)) : null
  if (!src) throw new HttpError(400, 'Pick one of your uploaded resumes (Settings → Resumes).')
  if (!/\.pdf$/i.test(src)) throw new HttpError(400, 'Only PDF resumes can be attached to applications.')
  const head = fs.readFileSync(src).subarray(0, 5).toString('latin1')
  if (head !== '%PDF-') throw new HttpError(400, 'That file isn’t a valid PDF.')

  const base = await getDefaultBase()
  const vid = await createVersion({
    base_id: base?.id ?? 0,
    job_id: s.job_id,
    session_id: sid,
    latex: '',
    generated_by: 'upload',
    status: 'draft',
    hint: path.basename(src),
  })
  // Copy into the version folder so later edits/deletes in Settings → Resumes
  // don't change what this application was sent with.
  const dest = pdfPathFor(vid)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  await updateVersion(vid, { pdf_path: dest, compile_log: { ok: true, errors: [] } })

  await sql.run("UPDATE resume_versions SET status = 'draft' WHERE session_id = ? AND status = 'locked'", [sid])
  await updateVersion(vid, { status: 'locked' })
  const next = await setStatus(sid, 'resume_ready', { resume_version_id: vid }, { type: 'resume.locked', actor: 'user', data: { version_id: vid, uploaded_pdf: path.basename(src) } })
  return json(next)
})
