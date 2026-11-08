import { addBankEntry, bankStats, listBank } from '@/lib/apply/learn'
import { HttpError, handler, json, readJson } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 100)
  return json({ items: await listBank(q || null), stats: await bankStats() })
})

export const POST = handler(async (req: Request) => {
  const { question, answer } = await readJson<{ question?: string; answer?: string }>(req)
  if (!question?.trim() || !answer?.trim()) throw new HttpError(400, 'Both a question and an answer are needed.')
  return json(await addBankEntry(question.trim(), answer.trim().slice(0, 5000)))
})
