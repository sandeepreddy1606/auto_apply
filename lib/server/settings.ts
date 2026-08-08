/** JSON-file settings store (profile, SMTP, templates, telegram, automation). */
import fs from 'node:fs'

import type { Settings } from '@/lib/types'

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
  email_template: {
    subject: 'Application for {job_title} - {full_name}',
    body: [
      'Dear Hiring Team,',
      '',
      'I came across your opening for the {job_title} role and would like to submit my application.',
      '',
      'A quick summary of my profile:',
      '- Experience: {experience_years}',
      '- Key skills: {skills}',
      '- Current location: {current_location}',
      '- Notice period: {notice_period}',
      '',
      'I have attached my resume for your review. You can also find my work here:',
      'LinkedIn: {linkedin}',
      'GitHub: {github}',
      'Portfolio: {portfolio}',
      '',
      'I would welcome the opportunity to discuss how I can contribute to your team.',
      '',
      'Best regards,',
      '{full_name}',
      '{phone}',
      '{email}',
    ].join('\n'),
  },
  telegram: {
    api_id: '',
    api_hash: '',
    phone: '',
    watched_chats: [],
  },
  automation: {
    auto_apply_email: false,
    auto_apply_gform: false,
  },
  companies: {
    match_keywords: '',
    scan_interval_minutes: 180,
    auto_scan: true,
  },
  // Uploaded resumes: [{id, name, original, stored, keywords, is_default, size_kb, added_at}]
  resumes: [],
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
function writeAtomic(path: string, text: string): void {
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
  for (const section of ['profile', 'smtp', 'telegram', 'companies'] as const) {
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
