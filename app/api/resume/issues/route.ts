import { lintBase, LintFixError, resolveIssue } from '@/lib/resume/lint'
import { addDismissed, getBase, getDefaultBase, getDismissed, updateBaseLatex } from '@/lib/resume/store'
import { HttpError, handler, json, readJson } from '@/lib/server/http'
import * as settingsStore from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

async function baseFrom(id: unknown) {
  const n = Number(id)
  const b = Number.isInteger(n) && n > 0 ? await getBase(n) : await getDefaultBase()
  if (!b) throw new HttpError(404, 'No base resume yet.')
  return b
}

export const GET = handler(async (req: Request) => {
  const b = await baseFrom(new URL(req.url).searchParams.get('base'))
  return json({ base_id: b.id, issues: lintBase(b.latex, settingsStore.load().profile, await getDismissed(b.id)) })
})

/** Apply one fix. Issues are looked up by id against the current text, so stale clicks can't misfire. */
export const POST = handler(async (req: Request) => {
  const body = await readJson<{ base_id?: number; issue_id?: string; action?: string; value?: string }>(req)
  const b = await baseFrom(body.base_id)
  const profile = settingsStore.load().profile
  const dismissed = await getDismissed(b.id)
  const issue = lintBase(b.latex, profile, dismissed).find((i) => i.id === body.issue_id)
  if (!issue) throw new HttpError(409, 'That issue is already resolved — refresh the list.')
  if (body.action === 'dismiss') {
    if (issue.severity === 'block') throw new HttpError(400, 'Blocking issues can’t be dismissed — resolve them instead.')
    await addDismissed(b.id, issue.id)
  } else {
    if (!issue.actions.some((a) => a.id === body.action)) throw new HttpError(400, 'Unknown action for this issue.')
    try {
      const next = resolveIssue(b.latex, issue, String(body.action), String(body.value ?? ''), profile)
      await updateBaseLatex(b.id, next, `${issue.title}: ${body.action}`)
    } catch (e) {
      if (e instanceof LintFixError) throw new HttpError(400, e.message)
      throw e
    }
  }
  const fresh = (await getBase(b.id))!
  return json({ base_id: b.id, issues: lintBase(fresh.latex, profile, await getDismissed(b.id)) })
})
