/** Shared shapes used by both the API routes and the client. */

export type ApplyMethod = 'email' | 'gform' | 'link' | 'unknown'
export type AppStatus = 'review' | 'applied' | 'failed' | 'manual' | 'skipped'
export type JobState = 'new' | 'seen' | 'dismissed' | 'applied'

export interface Profile {
  full_name: string
  email: string
  phone: string
  current_location: string
  preferred_location: string
  experience_years: string
  current_company: string
  current_role: string
  notice_period: string
  current_ctc: string
  expected_ctc: string
  skills: string
  degree: string
  college: string
  graduation_year: string
  gender: string
  date_of_birth: string
  willing_to_relocate: string
  linkedin: string
  github: string
  portfolio: string
  resume_url: string
  resume_path: string
  cover_note: string
}

export interface SmtpConfig {
  host: string
  port: number
  username: string
  password: string
  from_name: string
  use_ssl: boolean
}

export interface EmailTemplate {
  subject: string
  body: string
}

export interface WatchedChat {
  id: string
  title: string
}

export interface TelegramConfig {
  api_id: string
  api_hash: string
  phone: string
  watched_chats: WatchedChat[]
}

export interface AutomationConfig {
  auto_apply_email: boolean
  auto_apply_gform: boolean
}

export interface CompaniesConfig {
  match_keywords: string
  scan_interval_minutes: number
  auto_scan: boolean
}

export interface ResumeMeta {
  id: string
  name: string
  original: string
  stored: string
  keywords: string
  is_default: boolean
  size_kb: number
  added_at: string
}

export interface Settings {
  profile: Profile
  smtp: SmtpConfig
  email_template: EmailTemplate
  telegram: TelegramConfig
  automation: AutomationConfig
  companies: CompaniesConfig
  resumes: ResumeMeta[]
}

/** Values a Google Form answer can take: text, a checkbox list, or a date. */
export type FormAnswer = string | string[] | { year: string; month: string; day: string }
export type FormAnswers = Record<string, FormAnswer>

export interface ParsedExtra {
  batch?: string
  qualification?: string
  skills?: string
  notice_period?: string
  job_type?: string
  deadline?: string
  all_emails?: string[]
  all_form_urls?: string[]
  other_urls?: string[]
  subject_hint?: string | null
}

export interface Application {
  id: number
  created_at: string
  source: string
  channel: string | null
  raw_text: string
  text_hash: string | null
  method: ApplyMethod
  email_to: string | null
  form_url: string | null
  apply_url: string | null
  job_title: string | null
  company: string | null
  location: string | null
  experience: string | null
  salary: string | null
  extra: ParsedExtra | null
  email_subject: string | null
  email_body: string | null
  form_schema: GoogleForm | null
  form_answers: FormAnswers | null
  status: AppStatus
  status_reason: string | null
  error: string | null
  applied_at: string | null
  notes: string | null
}

export interface Company {
  id: number
  name: string
  career_url: string
  created_at: string
  last_scanned_at: string | null
  last_status: string | null
  last_error: string | null
  jobs_found: number
  active_jobs?: number
  matched_jobs?: number
  new_jobs?: number
}

export interface CompanyJob {
  id: number
  company_id: number
  url: string
  title: string
  location: string | null
  matched: number
  match_reason: string | null
  first_seen_at: string
  last_seen_at: string
  active: number
  state: JobState
  company_name?: string
}

export interface GoogleFormField {
  item_id: number
  entry_id: number
  title: string
  description: string
  type_code: number
  type: string
  required: boolean
  options: string[]
  supported: boolean
}

export interface GoogleForm {
  title: string
  description: string
  url: string
  submit_url: string
  fbzx: string | null
  collects_email: boolean
  page_count: number
  fields: GoogleFormField[]
}

export interface MissingQuestion {
  title: string
  type: string
  supported: boolean
}

export interface Stats {
  total: number
  by_status: Record<string, number>
  by_method: Record<string, number>
  applied_7d: number
  last_applied_at: string | null
  last_received_at: string | null
}

export type TelegramState =
  | 'disconnected'
  | 'awaiting_code'
  | 'awaiting_password'
  | 'connected'
  | 'error'

export interface TelegramStatus {
  state: TelegramState
  error: string | null
  watched_chats: WatchedChat[]
}

export interface EmailPreview {
  to: string | null
  subject: string
  body: string
  attachment: string | null
}

export interface FormLoadResult {
  form: GoogleForm
  answers: FormAnswers
  unanswered_required: MissingQuestion[]
}

export interface ApplyResult extends Application {
  needs_input?: boolean
  unanswered_required?: MissingQuestion[]
}

export interface BatchItemResult {
  id: number
  ok: boolean
  skipped?: string
  needs_input?: boolean
  job_title?: string | null
  error?: string | null
}

export interface BatchResult {
  applied: number
  needs_input: number
  total: number
  results: BatchItemResult[]
}

export interface ScanResult {
  found: number
  new: number
  matched: number
  gone: number
  keywords_used?: number
}

export interface CompanyJobsSummary {
  new_matched: number
  total_matched: number
  companies: number
}
