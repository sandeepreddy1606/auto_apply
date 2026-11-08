/**
 * Browser-side API client. The session lives in an httpOnly cookie, so requests
 * carry no token. The token is also mirrored to localStorage `aa_token` only
 * for the companion browser extension, which reads it from there.
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

/** Extension bridge only — the app itself authenticates with the cookie. */
export const extensionToken = {
  set: (t: string | undefined): void => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t)
    } catch {
      /* storage blocked */
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* storage blocked */
    }
  },
}

export interface AuthUser {
  id: number
  email: string
  name: string
  role: string
  created_at: string
  password_changed_at: string | null
  last_login_at: string | null
}

export type AuthState = 'signup' | 'upgrade' | 'login' | 'ready'

export interface AuthStatus {
  state: AuthState
  user: AuthUser | null
  email_reset: boolean
}

export interface AuthSession {
  id: number
  remember: boolean
  user_agent: string | null
  ip: string | null
  created_at: string
  last_seen_at: string
  expires_at: string
  current: boolean
}

export interface SignedIn {
  user: AuthUser
  token: string
  recovery_code?: string
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

/** Tell the app the session ended (expired, or signed out from another device). */
export function signalUnauthorized(path: string, status: number): void {
  if (status === 401 && !path.startsWith('/api/auth/') && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  signalUnauthorized(path, res.status)
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
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  signup: (b: { name: string; email: string; password: string }) =>
    request<SignedIn>('/api/auth/signup', post(b)),
  upgrade: (b: { name: string; email: string; current_password: string; new_password?: string }) =>
    request<SignedIn>('/api/auth/upgrade', post(b)),
  login: (email: string, password: string, remember: boolean) =>
    request<SignedIn>('/api/auth/login', post({ email, password, remember })),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', post()),
  forgot: (email: string) => request<{ ok: boolean }>('/api/auth/forgot', post({ email })),
  reset: (b: { email: string; password: string; code?: string; recovery_code?: string }) =>
    request<SignedIn>('/api/auth/reset', post(b)),
  me: () => request<{ user: AuthUser; session_id: number }>('/api/auth/me'),
  updateMe: (b: { name?: string; email?: string; password?: string }) =>
    request<{ user: AuthUser }>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(b) }),
  authChange: (current: string, next: string) =>
    request<{ ok: boolean }>('/api/auth/change', post({ current, new: next })),
  newRecoveryCode: (password: string) =>
    request<{ recovery_code: string }>('/api/auth/recovery', post({ password })),
  sessions: () => request<{ sessions: AuthSession[] }>('/api/auth/sessions'),
  revokeSession: (id: number) =>
    request<{ ok: boolean }>(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () =>
    request<{ revoked: number }>('/api/auth/sessions/revoke-others', post()),

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
  fillProfileFromResume: () =>
    request<{ filled: string[] }>('/api/resume/fill-profile', post()),
  testEmail: (to: string) =>
    request<{ ok: boolean }>('/api/settings/test_email', post({ to })),

  listResumes: () => request<{ resumes: ResumeMeta[] }>('/api/resumes'),
  uploadResume: async (file: File, name?: string, keywords?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', name || '')
    fd.append('keywords', keywords || '')
    const res = await fetch('/api/resumes', { method: 'POST', credentials: 'same-origin', body: fd })
    signalUnauthorized('/api/resumes', res.status)
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
    const res = await fetch(`/api/resumes/${id}/file`, { credentials: 'same-origin' })
    signalUnauthorized('/api/resumes', res.status)
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
