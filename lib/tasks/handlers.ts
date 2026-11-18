/**
 * Task type → handler. Loaded only by the worker process (it pulls in
 * Playwright and the LLM layer lazily).
 */
import type { Task } from './queue'

export type Handler = (task: Task) => Promise<unknown>

const num = (v: unknown, what: string): number => {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Task payload missing ${what}`)
  return n
}

export const HANDLERS: Record<string, Handler> = {
  async 'jobs.fetch_jd'(t) {
    const { fetchAndStoreJd } = await import('@/lib/jobs/jd')
    return fetchAndStoreJd(num(t.payload.job_id, 'job_id'))
  },
  async 'jobs.rescore'() {
    const { rescoreJobs } = await import('@/lib/jobs/store')
    return { scored: await rescoreJobs() }
  },
  async 'companies.scan'(t) {
    const { runScanTask } = await import('@/lib/companies/scan-task')
    return runScanTask(num(t.payload.company_id, 'company_id'))
  },
  async 'resume.tailor'(t) {
    const { runTailor } = await import('@/lib/resume/tailor')
    const { updateVersion } = await import('@/lib/resume/store')
    const id = num(t.payload.version_id, 'version_id')
    try {
      // Tailoring to a bare job title wastes a Claude call: fetch the description first.
      const { getVersion } = await import('@/lib/resume/store')
      const { getJob } = await import('@/lib/jobs/store')
      const v = await getVersion(id)
      const job = v?.job_id ? await getJob(v.job_id) : null
      if (job && !job.description_text) {
        const { fetchAndStoreJd } = await import('@/lib/jobs/jd')
        await fetchAndStoreJd(job.id).catch(() => {})
      }
      return await runTailor(id)
    } catch (e) {
      await updateVersion(id, { status: 'failed', error: (e as Error).message.slice(0, 500) })
      throw e
    }
  },
  async 'resume.finish_manual'(t) {
    const { submitManualPlan } = await import('@/lib/resume/tailor')
    const { updateVersion } = await import('@/lib/resume/store')
    const id = num(t.payload.version_id, 'version_id')
    try {
      await submitManualPlan(id, String(t.payload.answer ?? ''))
    } catch (e) {
      await updateVersion(id, { status: 'awaiting_manual', error: (e as Error).message.slice(0, 500) })
      throw e
    }
    return { ok: true }
  },
  async 'apply.fill'(t) {
    const { runFill, runSubmit } = await import('@/lib/apply/executor')
    const sid = num(t.payload.session_id, 'session_id')
    await withSessionFailure(sid, () => runFill(sid))
    // One-click apply (Telegram careers-page links): submit straight away, but
    // only when the form is complete, on its last page, and no CAPTCHA showed.
    if (t.payload.auto_submit === true) {
      const { addEvent, getSession } = await import('@/lib/apply/sessions')
      const s = await getSession(sid)
      const captcha = s?.fill_plan?.warnings.some((w) => /captcha/i.test(w))
      if (s?.status === 'reviewing' && s.fill_plan?.final_step_reached && !captcha) {
        await addEvent(sid, 'submit.auto', 'system', { reason: 'every required answer filled' })
        await withSessionFailure(sid, () => runSubmit(sid))
      }
    }
    return { ok: true }
  },
  async 'apply.answers'(t) {
    const { runAnswers } = await import('@/lib/apply/executor')
    const sid = num(t.payload.session_id, 'session_id')
    return withSessionFailure(sid, () =>
      runAnswers(sid, (t.payload.values ?? {}) as Record<string, string>, t.payload.remember !== false),
    )
  },
  async 'apply.submit'(t) {
    const { runSubmit } = await import('@/lib/apply/executor')
    const sid = num(t.payload.session_id, 'session_id')
    return withSessionFailure(sid, () => runSubmit(sid))
  },
  async 'apply.cancel'(t) {
    const { runCancel } = await import('@/lib/apply/executor')
    return runCancel(num(t.payload.session_id, 'session_id'))
  },
  async 'apply.focus'(t) {
    const { focusPage } = await import('@/lib/apply/executor')
    return { focused: await focusPage(num(t.payload.session_id, 'session_id')) }
  },
  async 'apply.gform'(t) {
    // Every Google Form: answers worked out (incl. AI), then sent directly or
    // through the signed-in browser.
    const { runGform } = await import('@/lib/apply/gform-browser')
    return runGform(num(t.payload.application_id, 'application_id'))
  },
  async 'llm.gform_prepare'(t) {
    // "Fill with AI": answers on the post, nothing sent.
    const { prepareWithAi } = await import('@/lib/apply/gform-prepare')
    return prepareWithAi(num(t.payload.application_id, 'application_id'), { redo: t.payload.redo === true })
  },
  async 'apply.gform_focus'(t) {
    const { focusForm } = await import('@/lib/apply/gform-browser')
    return { focused: await focusForm(num(t.payload.application_id, 'application_id')) }
  },
  async 'browser.google_signin'() {
    const { googleSignIn } = await import('@/lib/apply/browser')
    const { kvSet } = await import('@/lib/tasks/queue')
    await kvSet('google.signin', { state: 'open', at: new Date().toISOString() })
    const r = await googleSignIn()
    await kvSet('google.signin', { ...r, at: new Date().toISOString() })
    if (r.state === 'signed_in') {
      // Forms that stopped for a Google account can go now.
      const { reopenSignInForms } = await import('@/lib/server/service')
      await reopenSignInForms({ signedIn: true }).catch(() => 0)
    }
    return r
  },
  async 'browser.open_profile'(t) {
    const { openProfileWindow } = await import('@/lib/apply/browser')
    await openProfileWindow(typeof t.payload.url === 'string' ? t.payload.url : 'about:blank')
    return { ok: true }
  },
  async 'setup.install'(t) {
    const { runInstaller } = await import('@/lib/setup/installers')
    return runInstaller(String(t.payload.tool ?? ''))
  },
}

/** Browser-lane failures must surface on the session, not just in the task table. */
async function withSessionFailure<T>(sessionId: number, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    const { setStatus, getSession } = await import('@/lib/apply/sessions')
    const { BrowserUnavailableError } = await import('@/lib/apply/browser')
    const s = await getSession(sessionId)
    const msg = (e as Error).message.split('\n')[0].slice(0, 400)
    if (s && !['submitted', 'cancelled'].includes(s.status)) {
      const to = e instanceof BrowserUnavailableError ? 'blocked' : 'failed'
      try {
        await setStatus(sessionId, s.status === 'submitting' ? 'unconfirmed' : to, { error: msg })
      } catch {
        /* transition not allowed from here; the error is still recorded on the task */
      }
    }
    throw e
  }
}
