async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
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
  getSettings: () => request('/api/settings'),
  getSettingsDefaults: () => request('/api/settings/defaults'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  checkResume: (path) => request('/api/settings/check_resume', { method: 'POST', body: JSON.stringify({ path }) }),
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
