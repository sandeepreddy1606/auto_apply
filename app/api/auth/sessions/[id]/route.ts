import { revokeSession } from '@/lib/server/auth'
import { authHandler, requireSession } from '@/lib/server/auth-http'
import { HttpError, intParam, json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const DELETE = authHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireSession(req)
  const id = intParam((await ctx.params).id)
  if (!(await revokeSession(user.id, id))) throw new HttpError(404, 'That device is already signed out.')
  return json({ ok: true })
})
