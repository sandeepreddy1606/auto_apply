/**
 * Files for a Google Form's upload questions.
 *
 * Each upload question gets its own file:
 *   - the one you chose on the post (one of your resumes, or a file you
 *     uploaded there — a photo, certificate, cover letter …), else
 *   - for a resume/CV question: the resume picked for this role, else
 *   - nothing: the question is listed as needing your file. Your resume is
 *     never put into a question that asks for something else.
 */
import fs from 'node:fs'
import path from 'node:path'

import * as resumes from '@/lib/server/resumes'
import * as settingsStore from '@/lib/server/settings'
import type { Application, FormFileChoice, GoogleForm, GoogleFormField, MissingQuestion } from '@/lib/types'

import { resumeFileName } from './filename'
import { resumeFor } from './post-apply'
import { ARTIFACTS_DIR } from './sessions'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const RESUME_Q = /\b(resume|résumé|cv|curriculum vitae|bio ?data)\b/i

export const postFilesDir = (appId: number) => path.join(ARTIFACTS_DIR, `post-${appId}`, 'files')

/** A safe file name (keeps the extension). */
export function safeName(name: string): string {
  const base = path.basename(name || 'file').replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(-120)
  return base || 'file'
}

export function uploadedFiles(appId: number): { name: string; size: number }[] {
  const dir = postFilesDir(appId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => fs.statSync(path.join(dir, n)).isFile())
    .map((n) => ({ name: n, size: fs.statSync(path.join(dir, n)).size }))
}

export function saveUpload(appId: number, name: string, data: Buffer): string {
  if (data.length > MAX_UPLOAD_BYTES) throw new Error('That file is over 10 MB — Google Forms usually refuse it.')
  const dir = postFilesDir(appId)
  fs.mkdirSync(dir, { recursive: true })
  const safe = safeName(name)
  fs.writeFileSync(path.join(dir, safe), data)
  return safe
}

export function deleteUpload(appId: number, name: string): void {
  fs.rmSync(path.join(postFilesDir(appId), safeName(name)), { force: true })
}

export interface UploadPick {
  key: string
  title: string
  required: boolean
  /** Where the file is, when one is set. */
  path: string | null
  /** Name the form will show. */
  name: string | null
  how: 'chosen' | 'role resume' | 'none'
}

/** Your resume copied under a clean name ("Firstname_Lastname_Resume.pdf"). */
function stagedResume(appId: number, file: string): string {
  const s = settingsStore.load()
  const name = resumeFileName(s.resume_prefs.filename_pattern, s.profile.full_name || 'Resume')
  const dir = path.join(ARTIFACTS_DIR, `post-${appId}`)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, path.extname(name) ? name : `${name}${path.extname(file)}`)
  fs.copyFileSync(file, dest)
  return dest
}

const OTHER_DOC = /\b(photo|picture|image|id|aadhaar|pan|certificate|marksheet|transcript|cover letter|portfolio|signature)\b/i

/** Which file a question gets (no copying). */
function choose(app: Application, f: GoogleFormField, uploads: GoogleFormField[]): { file: string | null; name: string | null; how: UploadPick['how']; resume: boolean } {
  const none = { file: null, name: null, how: 'none' as const, resume: false }
  const choice: FormFileChoice | undefined = app.form_files?.[`entry.${f.entry_id}`]
  if (choice?.kind === 'skip') return none
  if (choice?.kind === 'resume') {
    const p = resumes.pathFor(choice.id)
    if (p) return { file: p, name: resumes.filenameFor(choice.id), how: 'chosen', resume: true }
  }
  if (choice?.kind === 'file') {
    const p = path.join(postFilesDir(app.id), safeName(choice.name))
    if (fs.existsSync(p)) return { file: p, name: safeName(choice.name), how: 'chosen', resume: false }
  }
  // No choice: the role's resume, but only where a resume is what's asked for
  // (or the form's only upload question isn't obviously something else).
  const resumeLike = RESUME_Q.test(`${f.title} ${f.description}`) || (uploads.length === 1 && !OTHER_DOC.test(f.title))
  const r = resumeLike ? resumeFor(app) : null
  return r ? { file: r.file, name: r.name, how: 'role resume', resume: true } : none
}

/** The file for every upload question (copied ready to attach), and the required ones still without a file. */
export function planUploads(app: Application, form: GoogleForm): { picks: UploadPick[]; missing: MissingQuestion[] } {
  const uploads = form.fields.filter((f) => f.type_code === 13)
  const picks: UploadPick[] = uploads.map((f) => {
    const c = choose(app, f, uploads)
    return {
      key: `entry.${f.entry_id}`,
      title: f.title,
      required: f.required,
      path: c.file ? (c.resume ? stagedResume(app.id, c.file) : c.file) : null,
      name: c.name,
      how: c.how,
    }
  })
  const missing = picks
    .filter((p) => p.required && !p.path)
    .map((p) => ({
      title: p.title,
      type: 'file_upload',
      supported: true,
      note: RESUME_Q.test(p.title) ? 'Add a PDF resume in Settings → Resumes, or upload one here.' : 'Choose or upload the file this question asks for.',
    }))
  return { picks, missing }
}

/** For the post page: what each upload question would get. */
export function describeUploads(app: Application, form: GoogleForm): { key: string; title: string; required: boolean; name: string | null; how: UploadPick['how'] }[] {
  const uploads = form.fields.filter((f) => f.type_code === 13)
  return uploads.map((f) => {
    const c = choose(app, f, uploads)
    return { key: `entry.${f.entry_id}`, title: f.title, required: f.required, name: c.name, how: c.how }
  })
}
