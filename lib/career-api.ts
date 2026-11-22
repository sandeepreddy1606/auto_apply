/** Browser-side client for the career-page apply flow. */
import { request, signalUnauthorized } from '@/lib/api'
import type {
  AnswerBankEntry,
  AnswerValue,
  AppStage,
  ApplySession,
  FactBank,
  FactOverlay,
  JobDetail,
  JobListItem,
  JobPrefs,
  ResumeBase,
  ResumeIssue,
  ResumeVersion,
  SessionArtifact,
  SessionEvent,
  SetupCheck,
} from '@/lib/types'

export interface Gate {
  ok: boolean
  reason: string | null
  fix: string | null
}

export interface JobFacets {
  companies: { id: number; name: string; n: number }[]
  cities: { value: string; n: number }[]
  countries: { value: string; n: number }[]
  workModes: { value: string; n: number }[]
  types: { value: string; n: number }[]
  seniority: { value: string; n: number }[]
  education: { value: string; n: number }[]
  skills: { value: string; n: number }[]
  maxYears: { value: number; n: number }[]
  postedDays: { value: number; n: number }[]
}

export interface ApplyDetail {
  session: ApplySession
  job: JobDetail | null
  versions: Omit<ResumeVersion, 'latex'>[]
  events: SessionEvent[]
  artifacts: SessionArtifact[]
  gates: Record<'generate' | 'lock' | 'fill' | 'submit', Gate>
  /** "Use this resume" check for each version (by id). */
  lock_gates?: Record<number, Gate>
  reuse: { id: number; job_title: string; company_name: string; similarity: number }[]
}

export type TrackerRow = Omit<ApplySession, 'fill_plan' | 'jd_snapshot'> & {
  job_title: string
  company_name: string
  job_url: string
  fields: number
  needs_you: number
}

export type BaseWithMeta = ResumeBase & { issues: { block: number; warn: number; info: number }; history: number }

const qs = (p: Record<string, unknown>) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) })
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) })

/** Fetch a binary resource (sent with the session cookie) and return an object URL. */
export async function authedBlobUrl(path: string, init: RequestInit = {}): Promise<{ url: string; headers: Headers }> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' })
  signalUnauthorized(path, res.status)
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const d = (await res.json()) as { detail?: string; errors?: { line: number | null; message: string }[] }
      detail = d.detail || (d.errors ? d.errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message)).join('\n') : detail)
    } catch {
      /* keep */
    }
    throw new Error(detail)
  }
  return { url: URL.createObjectURL(await res.blob()), headers: res.headers }
}

/** Live session events (SSE). Returns a close function. */
export function streamSession(sid: number, after: number, onEvent: (e: SessionEvent) => void): () => void {
  // Same-origin EventSource sends the session cookie.
  const es = new EventSource(`/api/apply/${sid}/stream${qs({ after })}`)
  es.addEventListener('session', (m) => {
    try {
      onEvent(JSON.parse((m as MessageEvent).data) as SessionEvent)
    } catch {
      /* ignore malformed */
    }
  })
  return () => es.close()
}

export const career = {
  // jobs
  jobs: (p: { view?: string; q?: string; company?: number | null; min_score?: number; sort?: string; limit?: number; offset?: number } & Record<string, unknown> = {}) =>
    request<{ items: JobListItem[]; total: number }>(`/api/jobs${qs(p)}`),
  jobFacets: (p: Record<string, unknown> = {}) => request<JobFacets>(`/api/jobs/facets${qs(p)}`),
  job: (id: number) => request<JobDetail>(`/api/jobs/${id}`),
  setJobState: (id: number, state: string) => request<JobDetail>(`/api/jobs/${id}`, patch({ state })),
  refreshJob: (id: number) => request<{ task_id: number }>(`/api/jobs/${id}/refresh`, post()),
  startApply: (id: number) => request<{ session_id: number; warnings: string[]; existing: boolean }>(`/api/jobs/${id}/apply`, post()),
  previewCount: (prefs: Partial<JobPrefs>) => request<{ relevant: number; total: number }>('/api/jobs/preview-count', post(prefs)),
  setCompanyPriority: (id: number, priority: string) => request(`/api/companies/${id}`, patch({ priority })),

  // apply sessions
  sessions: (status?: string) => request<TrackerRow[]>(`/api/apply${qs({ status })}`),
  session: (sid: number) => request<ApplyDetail>(`/api/apply/${sid}`),
  generate: (sid: number, hint?: string) => request<{ version_id: number }>(`/api/apply/${sid}/resume/generate`, post({ hint })),
  lock: (sid: number, version_id: number) => request<ApplySession>(`/api/apply/${sid}/resume/lock`, post({ version_id })),
  uploadedPdfs: (sid: number) =>
    request<{ items: { id: string; name: string; original: string; size_kb: number; is_default: boolean; exists: boolean }[] }>(`/api/apply/${sid}/resume/use-pdf`),
  usePdf: (sid: number, resume_id: string) => request<ApplySession>(`/api/apply/${sid}/resume/use-pdf`, post({ resume_id })),
  reuse: (sid: number, version_id: number) => request<{ version_id: number }>(`/api/apply/${sid}/resume/reuse`, post({ version_id })),
  fill: (sid: number) => request<{ task_id: number }>(`/api/apply/${sid}/fill`, post()),
  answers: (sid: number, values: Record<string, AnswerValue>, remember = true, save_to_answers?: Record<string, string>) =>
    request<{ task_id: number }>(`/api/apply/${sid}/answers`, patch({ values, remember, save_to_answers })),
  submit: (sid: number) => request<{ task_id: number }>(`/api/apply/${sid}/submit`, post()),
  confirm: (sid: number, submitted: boolean) => request<ApplySession>(`/api/apply/${sid}/confirm`, post({ submitted })),
  selfSubmitted: (sid: number) => request<ApplySession>(`/api/apply/${sid}/confirm`, post({ submitted: true, self: true })),
  cancel: (sid: number) => request<ApplySession>(`/api/apply/${sid}/cancel`, post()),
  stage: (sid: number, stage: AppStage, notes?: string) => request<ApplySession>(`/api/apply/${sid}/stage`, patch({ stage, notes })),
  focus: (sid: number) => request(`/api/apply/${sid}/focus`, post()),

  // resume versions
  version: (vid: number) => request<ResumeVersion>(`/api/resume/versions/${vid}`),
  saveVersion: (vid: number, latex: string) => request<ResumeVersion>(`/api/resume/versions/${vid}`, put({ latex })),
  compileVersion: (vid: number) => request<ResumeVersion>(`/api/resume/versions/${vid}/compile`, post()),
  manualPrompt: (vid: number) => request<{ prompt: string; reason: string | null }>(`/api/resume/versions/${vid}/manual`),
  manualAnswer: (vid: number, answer: string) => request<{ ok: boolean }>(`/api/resume/versions/${vid}/manual`, post({ answer })),

  // bases / issues / facts
  bases: () => request<BaseWithMeta[]>('/api/resume/bases'),
  createBase: (name: string, latex: string, make_default = false) => request<ResumeBase>('/api/resume/bases', post({ name, latex, make_default })),
  updateBase: (id: number, body: { latex?: string; name?: string; make_default?: boolean; undo?: boolean }) =>
    request<ResumeBase & { history: number }>(`/api/resume/bases/${id}`, put(body)),
  deleteBase: (id: number) => request(`/api/resume/bases/${id}`, { method: 'DELETE' }),
  issues: (base?: number) => request<{ base_id: number; issues: ResumeIssue[] }>(`/api/resume/issues${qs({ base })}`),
  resolveIssue: (base_id: number, issue_id: string, action: string, value = '') =>
    request<{ base_id: number; issues: ResumeIssue[] }>('/api/resume/issues', post({ base_id, issue_id, action, value })),
  facts: (base?: number) => request<{ base_id: number; facts: FactBank; overlay: FactOverlay }>(`/api/resume/facts${qs({ base })}`),
  saveOverlay: (base_id: number, overlay: Partial<FactOverlay>) =>
    request<{ base_id: number; facts: FactBank; overlay: FactOverlay }>('/api/resume/facts', put({ base_id, overlay })),

  // answer bank
  bank: (q?: string) => request<{ items: AnswerBankEntry[]; stats: { answers: number; mappings: number } }>(`/api/answers${qs({ q })}`),
  addBank: (question: string, answer: string) => request<AnswerBankEntry>('/api/answers', post({ question, answer })),
  updateBank: (id: number, body: { question?: string; answer?: string }) => request(`/api/answers/${id}`, put(body)),
  deleteBank: (id: number) => request(`/api/answers/${id}`, { method: 'DELETE' }),

  // setup / ai / browser
  setup: () => request<{ checks: SetupCheck[]; installs: Record<string, { running?: boolean; ok?: boolean; log?: string }>; queue: Record<string, number> }>('/api/setup/status'),
  install: (tool: string) => request<{ task_id: number }>(`/api/setup/install/${tool}`, post()),
  restartWorker: () => request('/api/setup/worker', post()),
  llmStatus: () => request<{ provider: string; ok: boolean; detail: string; version: string | null; calls_today: number; last_test: { ok: boolean; detail: string; at: string } | null }>('/api/llm/status'),
  llmTest: () => request<{ provider: string; ok: boolean; detail: string; version: string | null; calls_today: number }>('/api/llm/test', post()),
  openBrowser: (url?: string) => request('/api/browser/open-profile', post({ url })),
}
