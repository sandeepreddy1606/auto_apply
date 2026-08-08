/**
 * Browser-side API client. Paths and the `aa_token` storage key are unchanged
 * from the previous build so the companion browser extension keeps working.
 */
import type {
  Application,
  ApplyResult,
  BatchResult,
  Company,
  CompanyJob,
  CompanyJobsSummary,
  EmailPreview,
  FormAnswers,
  FormLoadResult,
  ResumeMeta,
  ScanResult,
  Settings,
  Stats,
  TelegramStatus,
  WatchedChat,
} from '@/lib/types'

const TOKEN_KEY = 'aa_token'

export const auth = {
  get: (): string | null =>
    typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY),
  set: (t: string): void => localStorage.setItem(TOKEN_KEY, t),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
}

export const UNAUTHORIZED_EVENT = 'aa-unauthorized'

async function errorFrom(res: Response): Promise<Error> {
  let detail = `HTTP ${res.status}`
  try {
    const data = (await res.json()) as { detail?: string }
    detail = data.detail || JSON.stringify(data)
  } catch {
    /* keep default */
  }
  return new Error(detail)
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = auth.get()
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    // Only log out if the token that got rejected is still the current one. A
    // slow request issued with an old token (e.g. a background poll that
    // overlaps a password change) must NOT bounce the freshly-authed user.
    if (auth.get() === token) {
      auth.clear()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
  }
  if (!res.ok) throw await errorFrom(res)
  return res.json() as Promise<T>
}

const qs = (params: Record<string, unknown>): string => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const post = (body: unknown = {}): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
})

export const api = {
  authStatus: () =>
    request<{ password_set: boolean; authenticated: boolean }>('/api/auth/status'),
  authSetup: (password: string) =>
    request<{ token: string }>('/api/auth/setup', post({ password })),
  authLogin: (password: string) =>
    request<{ token: string }>('/api/auth/login', post({ password })),
  authChange: (current: string, next: string) =>
    request<{ token: string }>('/api/auth/change', post({ current, new: next })),

  stats: () => request<Stats>('/api/stats'),
  activity: () => request<Record<string, number>>('/api/activity'),

  listApplications: (params: Record<string, unknown> = {}) =>
    request<Application[]>(`/api/applications${qs(params)}`),
  getApplication: (id: number) => request<Application>(`/api/applications/${id}`),
  patchApplication: (id: number, body: Partial<Application>) =>
    request<Application>(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteApplication: (id: number) =>
    request<{ ok: boolean }>(`/api/applications/${id}`, { method: 'DELETE' }),
  ingest: (text: string, channel?: string) =>
    request<{ created: Application[] }>('/api/messages/ingest', post({ text, channel })),
  emailPreview: (id: number) =>
    request<EmailPreview>(`/api/applications/${id}/email_preview`),
  loadForm: (id: number) => request<FormLoadResult>(`/api/applications/${id}/form`),
  apply: (id: number, body: Record<string, unknown> = {}) =>
    request<ApplyResult>(`/api/applications/${id}/apply`, post(body)),
  applyBatch: (ids: number[]) =>
    request<BatchResult>('/api/applications/apply_batch', post({ ids })),

  getSettings: () => request<Settings>('/api/settings'),
  getSettingsDefaults: () => request<Settings>('/api/settings/defaults'),
  saveSettings: (body: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  checkResume: (path: string) =>
    request<{ exists: boolean; filename?: string; size_kb?: number }>(
      '/api/settings/check_resume',
      post({ path }),
    ),
  testEmail: (to: string) =>
    request<{ ok: boolean }>('/api/settings/test_email', post({ to })),

  listResumes: () => request<{ resumes: ResumeMeta[] }>('/api/resumes'),
  uploadResume: async (file: File, name?: string, keywords?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', name || '')
    fd.append('keywords', keywords || '')
    const token = auth.get()
    const res = await fetch('/api/resumes', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (res.status === 401) {
      auth.clear()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    if (!res.ok) throw await errorFrom(res)
    return res.json() as Promise<ResumeMeta>
  },
  updateResume: (id: string, body: Partial<ResumeMeta>) =>
    request<ResumeMeta>(`/api/resumes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteResume: (id: string) =>
    request<{ ok: boolean }>(`/api/resumes/${id}`, { method: 'DELETE' }),
  downloadResume: async (id: string, filename?: string) => {
    const token = auth.get()
    const res = await fetch(`/api/resumes/${id}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Could not download the file.')
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'resume'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  listCompanies: () => request<Company[]>('/api/companies'),
  addCompany: (name: string, career_url: string) =>
    request<Company>('/api/companies', post({ name, career_url })),
  deleteCompany: (id: number) =>
    request<{ ok: boolean }>(`/api/companies/${id}`, { method: 'DELETE' }),
  scanCompany: (id: number) =>
    request<{ company: Company; result: ScanResult }>(`/api/companies/${id}/scan`, post()),
  scanAllCompanies: () =>
    request<{ started: number }>('/api/companies/scan_all', post()),

  listCompanyJobs: (params: Record<string, unknown> = {}) =>
    request<CompanyJob[]>(`/api/company_jobs${qs(params)}`),
  patchCompanyJob: (id: number, state: string) =>
    request<CompanyJob>(`/api/company_jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    }),
  markCompanyJobsSeen: () =>
    request<{ updated: number }>('/api/company_jobs/mark_seen', post()),
  companyJobsSummary: () => request<CompanyJobsSummary>('/api/company_jobs/summary'),

  tgStatus: () => request<TelegramStatus>('/api/telegram/status'),
  tgConnect: () => request<TelegramStatus>('/api/telegram/connect', post()),
  tgCode: (code: string) => request<TelegramStatus>('/api/telegram/code', post({ code })),
  tgPassword: (password: string) =>
    request<TelegramStatus>('/api/telegram/password', post({ password })),
  tgChats: () => request<WatchedChat[]>('/api/telegram/chats'),
  tgWatch: (chats: WatchedChat[]) =>
    request<TelegramStatus>('/api/telegram/watch', post({ chats })),
  tgDisconnect: () => request<TelegramStatus>('/api/telegram/disconnect', post()),
}

export type { FormAnswers }
