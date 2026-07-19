const TOKEN_KEY = 'aa_token'
export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

async function request(path, options = {}) {
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
    // Only log out if the token that got rejected is still the current one.
    // A slow request issued with an old token (e.g. a background poll that
    // overlaps a password change) must NOT bounce the freshly-authed user.
    if (auth.get() === token) {
      auth.clear()
      window.dispatchEvent(new Event('aa-unauthorized'))
    }
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail || JSON.stringify(data)
    } catch { /* keep default */ }
    throw new Error(detail)
  }
  return res.json()
}

export const api = {
  authStatus: () => request('/api/auth/status'),
  authSetup: (password) => request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) }),
  authLogin: (password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  authChange: (current, next) => request('/api/auth/change', { method: 'POST', body: JSON.stringify({ current, new: next }) }),
  stats: () => request('/api/stats'),
  activity: () => request('/api/activity'),
  listApplications: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v)
    ).toString()
    return request(`/api/applications${qs ? '?' + qs : ''}`)
  },
  getApplication: (id) => request(`/api/applications/${id}`),
  patchApplication: (id, body) =>
    request(`/api/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteApplication: (id) => request(`/api/applications/${id}`, { method: 'DELETE' }),
  ingest: (text, channel) =>
    request('/api/messages/ingest', { method: 'POST', body: JSON.stringify({ text, channel }) }),
  emailPreview: (id) => request(`/api/applications/${id}/email_preview`),
  loadForm: (id) => request(`/api/applications/${id}/form`),
  apply: (id, body = {}) =>
    request(`/api/applications/${id}/apply`, { method: 'POST', body: JSON.stringify(body) }),
  applyBatch: (ids) =>
    request('/api/applications/apply_batch', { method: 'POST', body: JSON.stringify({ ids }) }),
  getSettings: () => request('/api/settings'),
  getSettingsDefaults: () => request('/api/settings/defaults'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  checkResume: (path) => request('/api/settings/check_resume', { method: 'POST', body: JSON.stringify({ path }) }),
  listResumes: () => request('/api/resumes'),
  uploadResume: async (file, name, keywords) => {
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
    if (res.status === 401) { auth.clear(); window.dispatchEvent(new Event('aa-unauthorized')) }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try { detail = (await res.json()).detail || detail } catch { /* keep */ }
      throw new Error(detail)
    }
    return res.json()
  },
  updateResume: (id, body) => request(`/api/resumes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteResume: (id) => request(`/api/resumes/${id}`, { method: 'DELETE' }),
  downloadResume: async (id, filename) => {
    const token = auth.get()
    const res = await fetch(`/api/resumes/${id}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Could not download the file.')
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url; a.download = filename || 'resume'
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  },
  testEmail: (to) => request('/api/settings/test_email', { method: 'POST', body: JSON.stringify({ to }) }),
  listCompanies: () => request('/api/companies'),
  addCompany: (name, career_url) =>
    request('/api/companies', { method: 'POST', body: JSON.stringify({ name, career_url }) }),
  deleteCompany: (id) => request(`/api/companies/${id}`, { method: 'DELETE' }),
  scanCompany: (id) => request(`/api/companies/${id}/scan`, { method: 'POST', body: '{}' }),
  scanAllCompanies: () => request('/api/companies/scan_all', { method: 'POST', body: '{}' }),
  listCompanyJobs: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    return request(`/api/company_jobs${qs ? '?' + qs : ''}`)
  },
  patchCompanyJob: (id, state) =>
    request(`/api/company_jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ state }) }),
  markCompanyJobsSeen: () => request('/api/company_jobs/mark_seen', { method: 'POST', body: '{}' }),
  companyJobsSummary: () => request('/api/company_jobs/summary'),
  tgStatus: () => request('/api/telegram/status'),
  tgConnect: () => request('/api/telegram/connect', { method: 'POST', body: '{}' }),
  tgCode: (code) => request('/api/telegram/code', { method: 'POST', body: JSON.stringify({ code }) }),
  tgPassword: (password) => request('/api/telegram/password', { method: 'POST', body: JSON.stringify({ password }) }),
  tgChats: () => request('/api/telegram/chats'),
  tgWatch: (chats) => request('/api/telegram/watch', { method: 'POST', body: JSON.stringify({ chats }) }),
  tgDisconnect: () => request('/api/telegram/disconnect', { method: 'POST', body: '{}' }),
}
