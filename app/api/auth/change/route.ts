import { changePassword, issueToken } from '@/lib/server/auth'
import { HttpError, handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ current?: string; new?: string }>(req)
  try {
    changePassword(body.current || '', body.new || '')
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
  // Old tokens are now invalid (secret rotated); hand back a fresh one.
  return json({ token: issueToken() })
})
