import { deleteUpload, describeUploads, MAX_UPLOAD_BYTES, safeName, saveUpload, uploadedFiles } from '@/lib/apply/gform-files'
import * as db from '@/lib/server/db'
import { HttpError, handler, intParam, json, readJson } from '@/lib/server/http'
import * as resumes from '@/lib/server/resumes'
import type { Application, FormFileChoice } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function post(ctx: Ctx): Promise<Application> {
  const app = await db.getApplication(intParam((await ctx.params).id))
  if (!app) throw new HttpError(404, 'Post not found')
  return app
}

/** What each upload question will get, your resumes, and the files uploaded on this post. */
async function view(app: Application) {
  return {
    questions: app.form_schema ? describeUploads(app, app.form_schema) : [],
    choices: app.form_files ?? {},
    resumes: resumes.listResumes().map((r) => ({ id: r.id, name: r.name || r.original })),
    uploaded: uploadedFiles(app.id),
  }
}

export const GET = handler(async (_req: Request, ctx: Ctx) => json(await view(await post(ctx))))

/** Upload a file (multipart: file, optional entry = the question to use it for). */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const app = await post(ctx)
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'No file in the upload.')
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'That file is over 10 MB — Google Forms usually refuse it.')
  const name = saveUpload(app.id, file.name, Buffer.from(await file.arrayBuffer()))
  const entry = String(form.get('entry') || '')
  if (/^entry\.\d+$/.test(entry)) {
    await db.updateApplication(app.id, { form_files: { ...(app.form_files ?? {}), [entry]: { kind: 'file', name } } })
  }
  return json(await view((await db.getApplication(app.id))!))
})

/** Choose the file for one question: {entry, choice: {kind:'resume',id} | {kind:'file',name} | {kind:'skip'} | null (= automatic)}. */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const app = await post(ctx)
  const body = await readJson<{ entry?: string; choice?: FormFileChoice | null }>(req)
  const entry = String(body.entry || '')
  if (!/^entry\.\d+$/.test(entry)) throw new HttpError(400, 'Which question? (entry missing)')
  const files = { ...(app.form_files ?? {}) }
  const c = body.choice
  if (!c) delete files[entry]
  else if (c.kind === 'resume' && resumes.pathFor(String(c.id))) files[entry] = { kind: 'resume', id: String(c.id) }
  else if (c.kind === 'file' && uploadedFiles(app.id).some((f) => f.name === safeName(c.name))) files[entry] = { kind: 'file', name: safeName(c.name) }
  else if (c.kind === 'skip') files[entry] = { kind: 'skip' }
  else throw new HttpError(400, 'That file isn’t available.')
  await db.updateApplication(app.id, { form_files: files })
  return json(await view((await db.getApplication(app.id))!))
})

/** Remove a file uploaded on this post (?name=…); questions using it go back to automatic. */
export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const app = await post(ctx)
  const name = safeName(new URL(req.url).searchParams.get('name') || '')
  deleteUpload(app.id, name)
  const files = Object.fromEntries(Object.entries(app.form_files ?? {}).filter(([, c]) => !(c.kind === 'file' && c.name === name)))
  await db.updateApplication(app.id, { form_files: files })
  return json(await view((await db.getApplication(app.id))!))
})
