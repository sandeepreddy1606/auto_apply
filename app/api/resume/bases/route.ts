import { lintBase } from '@/lib/resume/lint'
import { createBase, getDismissed, historyCount, listBases } from '@/lib/resume/store'
import { HttpError, handler, json, readJson } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'
import { enqueue } from '@/lib/tasks/queue'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => {
  const profile = settingsStore.load().profile
  const bases = await listBases()
  return json(
    await Promise.all(
      bases.map(async (b) => {
        const issues = lintBase(b.latex, profile, await getDismissed(b.id))
        return {
          ...b,
          issues: { block: issues.filter((i) => i.severity === 'block').length, warn: issues.filter((i) => i.severity === 'warn').length, info: issues.filter((i) => i.severity === 'info').length },
          history: await historyCount(b.id),
        }
      }),
    ),
  )
})

export const POST = handler(async (req: Request) => {
  const { name, latex, make_default } = await readJson<{ name?: string; latex?: string; make_default?: boolean }>(req)
  if (typeof latex !== 'string' || !latex.includes('\\begin{document}')) {
    throw new HttpError(400, 'Paste or upload a complete .tex file (it must contain \\begin{document}).')
  }
  if (latex.length > 400_000) throw new HttpError(413, 'File too large.')
  const base = await createBase((name || 'Base resume').trim(), latex, !!make_default)
  await enqueue('jobs.rescore', {}, { dedupeKey: 'jobs.rescore' }) // your skills changed
  return json(base)
})
