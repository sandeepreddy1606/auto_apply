import { issueToken, setPassword } from '@/lib/server/auth'
import { HttpError, handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ password?: string }>(req)
  try {
    setPassword(body.password || '')
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
  return json({ token: issueToken() })
})
