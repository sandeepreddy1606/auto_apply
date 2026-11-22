/** JSON-file settings store (profile, job preferences, answers, resume, AI, browser, SMTP). */
import fs from 'node:fs'

import type { AiConfig, JobPrefs, ResumePrefs, Settings } from '@/lib/types'

import { SETTINGS_PATH } from './paths'

export const DEFAULTS: Settings = {
  profile: {
    full_name: '',
    email: '',
    phone: '',
    current_location: '',
    preferred_location: '',
    experience_years: '',
    current_company: '',
    current_role: '',
    notice_period: '',
    current_ctc: '',
    expected_ctc: '',
    skills: '',
    degree: '',
    college: '',
    graduation_year: '',
    gender: '',
    date_of_birth: '',
    willing_to_relocate: 'Yes',
    linkedin: '',
    github: '',
    portfolio: '',
    resume_url: '',
    resume_path: '',
    cover_note: '',
  },
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    username: '',
    password: '',
    from_name: '',
    use_ssl: false,
  },
  companies: {
    match_keywords: '',
    scan_interval_minutes: 180,
    auto_scan: true,
  },
  // Uploaded resumes: [{id, name, original, stored, keywords, is_default, size_kb, added_at}]
  resumes: [],
  job_prefs: {
    target_roles: [],
    seniority: ['intern', 'new_grad', 'junior'],
    experience_years_override: '',
    locations: [],
    remote_ok: true,
    open_to_relocation: true,
    include_keywords: [],
    exclude_keywords: ['Senior', 'Staff', 'Principal', 'Lead', 'Manager', '5+ years', '10+ years'],
    excluded_companies: [],
    threshold: 55,
    freshness_days: 45,
    require_title_match: true,
    max_experience_gap: 2,
  },
  apply_answers: {
    citizenship: '',
    authorized_india: '',
    other_countries: '',
    sponsorship_now: '',
    sponsorship_future: '',
    notice_period: '',
    start_date: '',
    currency: 'INR',
    current_ctc: '',
    expected_ctc: '',
    salary_text: 'Negotiable',
    leave_salary_blank: true,
    relocation: '',
    work_modes: ['Onsite', 'Hybrid', 'Remote'],
    travel: '',
    gender: '',
    pronouns: '',
    race: '',
    veteran: '',
    disability: '',
    hear_about: 'Company careers page',
    languages: '',
    over_18: 'Yes',
    background_check: '',
    always_ask: ['background_check'],
  },
  resume_prefs: {
    max_pages: 2,
    filename_pattern: '{First}_{Last}_Resume.pdf',
    style: 'balanced',
    rewrite_summary: true,
    projects_count: 3,
    drift_threshold: 60,
  },
  ai: {
    provider: 'claude-code',
    model: '',
    timeout_s: 180,
    daily_cap: 40,
    fallback_manual: true,
    claude_path: '',
    api_key: '',
  },
  apply_automation: {
    headless: false,
    session_timeout_min: 20,
    daily_cap: 20,
    duplicate_days: 14,
    typing_delay_ms: 40,
    screenshot_retention_days: 90,
    extra_domains: [],
    browser: 'chromium',
  },
}

/** Clamp a numeric setting into [min, max], falling back when it isn't a number. */
export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(v ?? '').trim(), 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

/** Normalize a chip list: strings only, trimmed, de-duplicated case-insensitively. */
export function cleanList(v: unknown, maxLen = 80): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of arr) {
    if (typeof item !== 'string') continue
    const s = item.trim().slice(0, maxLen)
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out
}

const SENIORITIES = new Set(['intern', 'new_grad', 'junior', 'mid', 'senior'])
const STYLES = new Set(['conservative', 'balanced', 'assertive'])
const PROVIDERS = new Set(['claude-code', 'manual', 'anthropic-api'])
const ANSWER_KEYS = Object.keys(DEFAULTS.apply_answers)

function sanitizeCareer(settings: Settings): void {
  const jp = settings.job_prefs
  jp.target_roles = cleanList(jp.target_roles)
  jp.seniority = cleanList(jp.seniority).filter((s) => SENIORITIES.has(s)) as JobPrefs['seniority']
  jp.experience_years_override = String(jp.experience_years_override ?? '').trim().slice(0, 10)
  jp.locations = cleanList(jp.locations)
  jp.include_keywords = cleanList(jp.include_keywords)
  jp.exclude_keywords = cleanList(jp.exclude_keywords)
  jp.excluded_companies = (Array.isArray(jp.excluded_companies) ? jp.excluded_companies : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
  jp.remote_ok = Boolean(jp.remote_ok)
  jp.open_to_relocation = Boolean(jp.open_to_relocation)
  jp.threshold = clampInt(jp.threshold, 0, 100, 55)
  jp.freshness_days = clampInt(jp.freshness_days, 3, 365, 45)
  jp.require_title_match = jp.require_title_match !== false
  jp.max_experience_gap = clampInt(jp.max_experience_gap, 0, 10, 2)

  const aa = settings.apply_answers as unknown as Json
  for (const [k, v] of Object.entries(aa)) {
    if (typeof v === 'string') aa[k] = v.trim().slice(0, 500)
  }
  settings.apply_answers.work_modes = cleanList(settings.apply_answers.work_modes)
  settings.apply_answers.always_ask = cleanList(settings.apply_answers.always_ask).filter((k) =>
    ANSWER_KEYS.includes(k),
  )
  settings.apply_answers.leave_salary_blank = Boolean(settings.apply_answers.leave_salary_blank)

  // One source of truth: these answers are edited on the Application answers
  // page, and the profile keeps the same values.
  const a = settings.apply_answers
  const p = settings.profile
  if (a.notice_period) p.notice_period = a.notice_period
  if (a.current_ctc) p.current_ctc = a.current_ctc
  if (a.expected_ctc) p.expected_ctc = a.expected_ctc
  if (a.relocation) p.willing_to_relocate = a.relocation
  if (a.gender) p.gender = a.gender

  const rp = settings.resume_prefs
  rp.max_pages = clampInt(rp.max_pages, 1, 3, 2)
  rp.projects_count = clampInt(rp.projects_count, 1, 6, 3)
  rp.drift_threshold = clampInt(rp.drift_threshold, 10, 100, 60)
  rp.style = (STYLES.has(rp.style) ? rp.style : 'balanced') as ResumePrefs['style']
  rp.rewrite_summary = Boolean(rp.rewrite_summary)
  rp.filename_pattern =
    String(rp.filename_pattern || '').trim().replace(/[\\/:*?"<>|]/g, '') ||
    DEFAULTS.resume_prefs.filename_pattern
  if (!/\.pdf$/i.test(rp.filename_pattern)) rp.filename_pattern += '.pdf'

  const ai = settings.ai
  ai.provider = (PROVIDERS.has(ai.provider) ? ai.provider : 'claude-code') as AiConfig['provider']
  ai.model = String(ai.model || '').trim().replace(/[^\w.\-[\]]/g, '').slice(0, 60)
  ai.timeout_s = clampInt(ai.timeout_s, 30, 900, 180)
  ai.daily_cap = clampInt(ai.daily_cap, 1, 1000, 40)
  ai.fallback_manual = Boolean(ai.fallback_manual)
  ai.claude_path = String(ai.claude_path || '').replace(/^"|"$/g, '').trim()
  ai.api_key = String(ai.api_key || '').trim()

  const au = settings.apply_automation
  au.headless = Boolean(au.headless)
  au.session_timeout_min = clampInt(au.session_timeout_min, 5, 120, 20)
  au.daily_cap = clampInt(au.daily_cap, 1, 200, 20)
  au.duplicate_days = clampInt(au.duplicate_days, 0, 365, 14)
  au.typing_delay_ms = clampInt(au.typing_delay_ms, 0, 300, 40)
  au.screenshot_retention_days = clampInt(au.screenshot_retention_days, 1, 3650, 90)
  au.browser = au.browser === 'chrome' ? 'chrome' : 'chromium'
  au.extra_domains = cleanList(au.extra_domains)
    .map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
}

type Json = Record<string, unknown>

const isPlainObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function deepMerge(base: Json, override: Json | undefined): Json {
  const out: Json = structuredClone(base)
  for (const [k, v] of Object.entries(override || {})) {
    out[k] = isPlainObject(v) && isPlainObject(out[k])
      ? deepMerge(out[k] as Json, v)
      : v
  }
  return out
}

/**
 * Write via a temp file + rename so a crash mid-write can never leave a
 * truncated/corrupt file (which would wipe all settings).
 */
export function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, text, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, path)
}

export function load(): Settings {
  let saved: Json = {}
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as Json
    } catch (e) {
      if (e instanceof SyntaxError) {
        // Corrupt file — keep a copy for recovery instead of silently
        // overwriting it with defaults on the next save.
        try {
          fs.renameSync(SETTINGS_PATH, `${SETTINGS_PATH}.corrupt`)
        } catch {
          /* best effort */
        }
      }
      saved = {}
    }
  }
  return deepMerge(DEFAULTS as unknown as Json, saved) as unknown as Settings
}

/** Normalize values so bad input can't break sending later. */
function sanitize(settings: Settings): Settings {
  for (const section of ['profile', 'smtp', 'companies'] as const) {
    const obj = settings[section] as unknown as Json
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') obj[k] = v.trim()
    }
  }

  const companies = settings.companies
  const minutes = Number.parseInt(String(companies.scan_interval_minutes ?? '').trim(), 10)
  companies.scan_interval_minutes = Number.isFinite(minutes)
    ? Math.min(Math.max(minutes, 15), 1440)
    : 180
  companies.auto_scan = Boolean(companies.auto_scan ?? true)

  const smtp = settings.smtp
  const port = Number.parseInt(String(smtp.port ?? '').trim(), 10)
  smtp.port = Number.isFinite(port) && port >= 1 && port <= 65535 ? port : 587
  smtp.use_ssl = Boolean(smtp.use_ssl)

  // Windows paths pasted from Explorer often come quoted.
  if (settings.profile.resume_path) {
    settings.profile.resume_path = settings.profile.resume_path.replace(/^"|"$/g, '').trim()
  }
  sanitizeCareer(settings)
  return settings
}

/**
 * Read-merge-write. Node runs this on one thread and none of the steps await,
 * so the sequence is atomic with respect to other requests — the RLock the
 * Python version needed has no equivalent hazard here.
 */
export function save(patch: Partial<Settings>): Settings {
  const merged = sanitize(
    deepMerge(load() as unknown as Json, patch as Json) as unknown as Settings,
  )
  writeAtomic(SETTINGS_PATH, JSON.stringify(merged, null, 2))
  return merged
}
