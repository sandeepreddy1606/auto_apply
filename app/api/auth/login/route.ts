import { isPasswordSet, issueToken, verifyPassword } from '@/lib/server/auth'
import { HttpError, handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: Request) => {
  const body = await readJson<{ password?: string }>(req)
  if (!isPasswordSet()) throw new HttpError(400, 'No password is set yet.')
  if (!verifyPassword(body.password || '')) {
    throw new HttpError(401, 'Incorrect password.')
  }
  return json({ token: issueToken() })
})
