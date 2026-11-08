import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CompilerMissingError, compileLatex } from '@/lib/resume/compile'
import { getBase } from '@/lib/resume/store'
import { HttpError, handler, intParam } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Preview-compile the base resume (Settings → Resume). Returns the PDF, or a
 * JSON error list with line numbers when compilation fails.
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const b = await getBase(intParam((await ctx.params).id))
  if (!b) throw new HttpError(404, 'Base resume not found')
  try {
    const r = await compileLatex(b.latex)
    if (!r.ok || !r.pdf) {
      return Response.json({ ok: false, errors: r.errors }, { status: 422 })
    }
    // Keep the last preview on disk for debugging; respond with the bytes.
    fs.writeFileSync(path.join(os.tmpdir(), `aa-base-${b.id}.pdf`), r.pdf)
    return new Response(new Uint8Array(r.pdf), {
      headers: { 'Content-Type': 'application/pdf', 'X-Pages': String(r.pages), 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    if (e instanceof CompilerMissingError) throw new HttpError(409, e.message)
    throw e
  }
})
