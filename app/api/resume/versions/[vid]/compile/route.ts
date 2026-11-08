import { CompilerMissingError } from '@/lib/resume/compile'
import { getVersion } from '@/lib/resume/store'
import { compileVersion } from '@/lib/resume/tailor'
import { HttpError, handler, intParam, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** Compile a version and refresh its ATS report (a few seconds; first runs may install packages). */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ vid: string }> }) => {
  const id = intParam((await ctx.params).vid)
  const v = await getVersion(id)
  if (!v) throw new HttpError(404, 'Version not found')
  if (v.status === 'generating') throw new HttpError(409, 'Wait for generation to finish.')
  try {
    await compileVersion(id)
  } catch (e) {
    if (e instanceof CompilerMissingError) throw new HttpError(409, e.message)
    throw e
  }
  return json(await getVersion(id))
})
