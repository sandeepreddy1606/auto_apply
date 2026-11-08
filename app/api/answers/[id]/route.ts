import { deleteBankEntry, updateBankEntry } from '@/lib/apply/learn'
import { handler, intParam, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const id = intParam((await ctx.params).id)
  const { question, answer } = await readJson<{ question?: string; answer?: string }>(req)
  await updateBankEntry(id, {
    question: typeof question === 'string' && question.trim() ? question.trim() : undefined,
    answer: typeof answer === 'string' ? answer.slice(0, 5000) : undefined,
  })
  return json({ ok: true })
})

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  await deleteBankEntry(intParam((await ctx.params).id))
  return json({ ok: true })
})
