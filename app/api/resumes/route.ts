import { HttpError, handler, json } from '@/lib/server/http'
import * as resumeStore from '@/lib/server/resumes'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => json({ resumes: resumeStore.listResumes() }))

export const POST = handler(async (req: Request) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'No file was uploaded.')

  const content = Buffer.from(await file.arrayBuffer())
  try {
    return json(
      resumeStore.addResume(
        file.name,
        content,
        String(form.get('name') ?? ''),
        String(form.get('keywords') ?? ''),
      ),
    )
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
})
