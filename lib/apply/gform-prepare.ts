/**
 * "Fill with AI" on a post: answer the form's empty questions from your data
 * (profile, saved answers, resume, the job post) WITHOUT sending anything.
 * The answers appear on the post marked "AI", for you to check and edit;
 * Apply then sends them. Runs in the worker (AI lane); progress is kept in
 * the kv table under gform.prepare:<post id>.
 */
import * as db from '@/lib/server/db'
import { fetchForm, GFormError } from '@/lib/server/gform'
import { kvSet } from '@/lib/tasks/queue'
import type { FormAnswerMeta } from '@/lib/types'

import { missingReason, planFormAnswers } from './gform-answers'
import { planUploads } from './gform-files'

export const prepareKey = (appId: number) => `gform.prepare:${appId}`

export type PrepareState = {
  state: 'running' | 'done' | 'failed'
  at: string
  message?: string
  filled?: number
  missing?: number
}

export async function prepareWithAi(appId: number, opts: { redo?: boolean } = {}): Promise<PrepareState> {
  const set = async (s: Omit<PrepareState, 'at'>) => {
    const v = { ...s, at: new Date().toISOString() }
    await kvSet(prepareKey(appId), v)
    return v
  }
  await set({ state: 'running', message: 'The AI is reading your resume and the job post…' })
  try {
    const app = await db.getApplication(appId)
    if (!app?.form_url) return set({ state: 'failed', message: 'This post has no Google Form.' })
    let form = app.form_schema
    if (!form) {
      try {
        form = await fetchForm(app.form_url)
      } catch (e) {
        const msg = e instanceof GFormError && e.needsSignIn
          ? 'This form needs your Google account, so its questions can only be read by pressing Apply once.'
          : `Couldn’t read the form: ${(e as Error).message}`
        return set({ state: 'failed', message: msg })
      }
    }
    // "Redo": forget the AI's earlier answers (yours always stay).
    const meta: Record<string, FormAnswerMeta> = { ...(form.answer_meta ?? {}) }
    if (opts.redo) for (const k of Object.keys(meta)) if (meta[k].source === 'ai') delete meta[k]
    const before = new Set(Object.entries(meta).filter(([, m]) => m.source === 'ai').map(([k]) => k))

    const plan = await planFormAnswers({ ...app, form_schema: { ...form, answer_meta: meta } }, form, { useAi: true })
    const files = planUploads(app, form)
    const notes = { ...plan.notes }
    for (const m of files.missing) {
      const key = files.picks.find((p) => p.title === m.title)?.key
      if (key && m.note) notes[key] = m.note
    }
    await db.updateApplication(appId, {
      form_schema: { ...form, answer_meta: plan.meta, missing_notes: notes, ineligible: plan.ineligible },
      form_answers: plan.answers,
    })

    if (plan.ai === 'unavailable') return set({ state: 'failed', message: 'The AI couldn’t be reached — check Settings → AI (Claude Code signed in?).' })
    if (plan.ai === 'off') return set({ state: 'failed', message: 'AI answers are turned off in Settings → Automation.' })

    const filled = Object.entries(plan.meta).filter(([k, m]) => m.source === 'ai' && !before.has(k)).length
    const missing = [...plan.missing, ...files.missing]
    const parts = [
      filled ? `The AI filled ${filled} answer${filled > 1 ? 's' : ''} — they’re marked “AI”; check or edit them, then Apply.` : 'Nothing new for the AI to fill.',
      plan.ineligible ? `Heads-up: this form may not fit you — ${plan.ineligible}.` : '',
      missing.length ? missingReason(missing) : '',
    ]
    return set({ state: 'done', message: parts.filter(Boolean).join(' '), filled, missing: missing.length })
  } catch (e) {
    return set({ state: 'failed', message: `The AI fill failed: ${(e as Error).message.split('\n')[0].slice(0, 200)}` })
  }
}
