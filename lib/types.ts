/** Shared shapes used by both the API routes and the client. */

export type ApplyMethod = 'email' | 'gform' | 'link' | 'unknown'
export type AppStatus = 'review' | 'applying' | 'applied' | 'failed' | 'manual' | 'skipped'
export type JobState = 'new' | 'seen' | 'shortlisted' | 'dismissed' | 'applied'

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
  /** 'group' | 'channel', when known. */
  kind?: string
  username?: string | null
}

/** Sync state of a watched group (kept in the kv table, not settings). */
export interface ChatSync {
  last_message_id: number
  last_fetch_at: string | null
  last_fetch_found: number
  last_fetch_new: number
  error: string | null
}

export interface TelegramConfig {
  api_id: string
  api_hash: string
  phone: string
  watched_chats: WatchedChat[]
  /** How many days of history to fetch when a group is added (0 = only new posts). */
  history_days: number
}

export interface AutomationConfig {
  auto_apply_email: boolean
  auto_apply_gform: boolean
  /** Start applying on career-page links as soon as a post arrives. */
  auto_apply_link: boolean
  /** After filling a career-page form, submit it when every required answer is in place. */
  link_auto_submit: boolean
  /** Google Forms: let the AI (your Claude subscription) answer what your profile and saved answers don't. */
  gform_use_ai: boolean
  /** Google Forms: tick standard declarations ("the information I gave is correct") for you. */
  gform_tick_declarations: boolean
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
  job_prefs: JobPrefs
  apply_answers: ApplyAnswers
  resume_prefs: ResumePrefs
  ai: AiConfig
  apply_automation: ApplyAutomationConfig
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
  /** Technologies mentioned in the post (read with the description reader). */
  skills_list?: string[]
  work_mode?: string
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
  /** Google Form upload questions: entry key → the file you chose for it. */
  form_files?: Record<string, FormFileChoice> | null
  status: AppStatus
  status_reason: string | null
  error: string | null
  applied_at: string | null
  notes: string | null
  /** When the message was posted in Telegram (null for pasted posts). */
  posted_at?: string | null
  tg_chat_id?: string | null
  tg_message_id?: number | null
  /** Career-page links: the browser run applying this post (apply_sessions.id). */
  session_id?: number | null
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
  ats_type?: string | null
  ats_token?: string | null
  priority?: 'high' | 'normal' | 'low' | null
  active_jobs?: number
  matched_jobs?: number
  new_jobs?: number
  /** Applications started for this company's jobs (not cancelled). */
  applications?: number
  /** 1 = never scanned automatically. */
  paused?: number
  /** Failed scans in a row (drives the retry backoff). */
  fail_count?: number
  next_scan_at?: string | null
  scan_state?: 'queued' | 'scanning' | null
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
  match_score?: number | null
  posted_at?: string | null
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
  /** Read in the signed-in browser: this form needs a Google account. */
  signed_in?: boolean
  /** Where each answer came from (entry key → source); "you" answers are never overwritten. */
  answer_meta?: Record<string, FormAnswerMeta>
  /** The form doesn't fit you (e.g. it only takes BCom/BBA graduates): why. */
  ineligible?: string | null
  /** Why a question was left for you (entry key → e.g. "Your 12th percentage isn't in your resume"). */
  missing_notes?: Record<string, string>
}

/** A file for an upload question: one of your resumes, a file uploaded on the post, or nothing. */
export type FormFileChoice = { kind: 'resume'; id: string } | { kind: 'file'; name: string } | { kind: 'skip' }

export type FormAnswerSource = 'you' | 'profile' | 'answers' | 'learned' | 'ai'

export interface FormAnswerMeta {
  source: FormAnswerSource
  /** For AI answers: fact = stated in your resume/profile; preference = from your settings; inferred = a judgement call. */
  basis?: 'fact' | 'preference' | 'inferred'
  note?: string
}

export interface MissingQuestion {
  title: string
  type: string
  supported: boolean
  /** Why it couldn't be answered automatically (e.g. "Your 12th-standard percentage isn't in your resume"). */
  note?: string
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
  /** Careers-page links: the browser run was queued (it finishes in the background). */
  started?: boolean
  job_title?: string | null
  error?: string | null
}

export interface BatchResult {
  applied: number
  /** Careers-page links queued for the browser. */
  started?: number
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

// ======================================================================
// Career-page apply flow (report/CAREER_APPLY_FLOW.md)
// ======================================================================

export type Seniority = 'intern' | 'new_grad' | 'junior' | 'mid' | 'senior'

/** Settings → Job preferences. */
export interface JobPrefs {
  target_roles: string[]
  seniority: Seniority[]
  experience_years_override: string
  locations: string[]
  remote_ok: boolean
  open_to_relocation: boolean
  include_keywords: string[]
  exclude_keywords: string[]
  excluded_companies: number[]
  threshold: number
  freshness_days: number
  /** Only count a job as relevant when its title matches one of your target roles. */
  require_title_match: boolean
  /** Filter out jobs asking for more than this many years beyond your experience (10 = off). */
  max_experience_gap: number
}

/** Settings → Application answers. '' = not set; keys listed in always_ask are never auto-filled. */
export interface ApplyAnswers {
  citizenship: string
  authorized_india: string
  other_countries: string
  sponsorship_now: string
  sponsorship_future: string
  notice_period: string
  start_date: string
  currency: string
  current_ctc: string
  expected_ctc: string
  salary_text: string
  leave_salary_blank: boolean
  relocation: string
  work_modes: string[]
  travel: string
  gender: string
  pronouns: string
  race: string
  veteran: string
  disability: string
  hear_about: string
  languages: string
  over_18: string
  background_check: string
  always_ask: string[]
}

export type TailorStyle = 'conservative' | 'balanced' | 'assertive'

/** Settings → Resume → Output. */
export interface ResumePrefs {
  max_pages: number
  filename_pattern: string
  style: TailorStyle
  rewrite_summary: boolean
  projects_count: number
  drift_threshold: number
}

export type LlmProviderId = 'claude-code' | 'manual' | 'anthropic-api'

/** Settings → AI. */
export interface AiConfig {
  provider: LlmProviderId
  model: string
  timeout_s: number
  daily_cap: number
  fallback_manual: boolean
  claude_path: string
  api_key: string
}

/** Settings → Apply automation. */
export interface ApplyAutomationConfig {
  headless: boolean
  session_timeout_min: number
  daily_cap: number
  duplicate_days: number
  typing_delay_ms: number
  screenshot_retention_days: number
  extra_domains: string[]
  /** chromium = Playwright's bundled browser; chrome = your installed Google Chrome (own profile). */
  browser: 'chromium' | 'chrome'
}

export type AtsType =
  | 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters'
  | 'recruitee' | 'workday' | 'icims' | 'taleo' | 'successfactors'
  | 'amazon' | 'eightfold' | 'google' | 'custom'

export interface ScoreBreakdown {
  title: number
  title_match: string | null
  skills: number
  skills_have: string[]
  skills_missing: string[]
  experience: number
  experience_range: string | null
  location: number
  freshness: number
  company: number
  excluded: string | null
  seniority: Seniority | null
}

export interface JobListItem {
  id: number
  company_id: number
  company_name: string
  title: string
  location: string | null
  url: string
  apply_url: string | null
  ats_type: string | null
  posted_at: string | null
  first_seen_at: string
  match_score: number | null
  match_breakdown: ScoreBreakdown | null
  state: JobState
  active: number
  has_description: boolean
  session_id: number | null
  session_status: string | null
  /** Same posting in other cities, folded into this row in the list. */
  more_locations?: number
}

export interface JobDetail extends JobListItem {
  /** The same posting in other cities. */
  siblings?: { id: number; location: string | null }[]
  description_html: string | null
  description_text: string | null
  jd_fetched_at: string | null
  keywords: { required: string[]; preferred: string[] } | null
  /** What the description asks for: experience, education, job type, work mode, pay, visa … */
  requirements: JobRequirements | null
  sessions: { id: number; status: string; stage: string | null; started_at: string }[]
}

export interface JobRequirements {
  experience: { min: number; max: number | null; text: string } | null
  experience_preferred: { min: number; max: number | null; text: string } | null
  education: { level: 'phd' | 'masters' | 'bachelors' | 'diploma' | null; fields: string[]; equivalent: boolean; text: string } | null
  employment_type: 'full-time' | 'part-time' | 'contract' | 'internship' | 'temporary' | null
  work_mode: 'remote' | 'hybrid' | 'onsite' | null
  salary: string | null
  visa: 'sponsors' | 'no-sponsorship' | null
  notice: string | null
  shift: string | null
  travel: string | null
  /** Short labels for chips: "3+ yrs", "Bachelor's (Computer Science)", "Full-time" … */
  summary: string[]
}

export type SessionStatus =
  | 'created' | 'resume_drafting' | 'resume_ready' | 'filling' | 'needs_input'
  | 'reviewing' | 'blocked' | 'submitting' | 'unconfirmed' | 'submitted'
  | 'failed' | 'cancelled'

export type AppStage = 'applied' | 'screening' | 'interview' | 'offer' | 'rejected' | 'ghosted'

/** An application Claude submitted on another site (Naukri, a career page). */
export type ClaudeAppStatus = 'applied' | 'needs_you' | 'interview' | 'offer' | 'rejected' | 'skipped'
export interface ClaudeApplication {
  id: number
  title: string
  company: string
  location: string
  experience: string
  /** Where it was submitted: "Naukri" or the career site's name. */
  platform: string
  url: string
  /** File name of the resume that was sent. */
  resume: string
  status: ClaudeAppStatus
  note: string
  applied_at: string
}

export type FieldKind =
  | 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'combobox' | 'date'

export interface FormField {
  id: string
  kind: FieldKind
  input_type: string
  label: string
  name: string
  required: boolean
  options: string[]
  max_length: number | null
  multiple: boolean
  step: number
}

export type AnswerSource =
  | 'resume' | 'mapping' | 'profile' | 'answers' | 'answer_bank' | 'generated' | 'user' | 'none'

export type AnswerValue = string | string[] | boolean | null

export interface PlannedAnswer {
  field_id: string
  value: AnswerValue
  source: AnswerSource
  confidence: 'high' | 'medium' | 'review' | 'none'
  needs_you: boolean
  note: string | null
  filled: boolean
  profile_key?: string | null
}

export interface FillPlan {
  ats_type: string
  fields: FormField[]
  answers: Record<string, PlannedAnswer>
  step: number
  final_step_reached: boolean
  warnings: string[]
}

export interface AtsCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface AtsReport {
  ok: boolean
  pages: number
  size_kb: number
  checks: AtsCheck[]
  coverage: {
    required_have: string[]
    required_missing: string[]
    preferred_have: string[]
    preferred_missing: string[]
    pct: number
    base_pct: number | null
  }
  text_preview: string
}

export interface GuardFlag {
  level: 'reject' | 'warn'
  where: string
  message: string
}

export interface CompileError {
  line: number | null
  message: string
}

export interface ResumeVersion {
  id: number
  base_id: number
  parent_id: number | null
  job_id: number | null
  session_id: number | null
  latex: string
  pdf_path: string | null
  page_count: number | null
  ats_report: AtsReport | null
  guard_report: { flags: GuardFlag[]; notes: string[] } | null
  compile_log: { ok: boolean; errors: CompileError[] } | null
  /** 'upload' = a ready-made PDF from Settings → Resumes (no LaTeX, no compiler needed). */
  generated_by: 'base' | 'llm' | 'user' | 'upload'
  status: 'draft' | 'locked' | 'generating' | 'awaiting_manual' | 'failed'
  hint: string | null
  error: string | null
  llm_call_id: number | null
  created_at: string
}

export interface ResumeBase {
  id: number
  name: string
  latex: string
  is_default: number
  created_at: string
  updated_at: string
}

export interface ResumeIssueAction {
  id: string
  label: string
  needs_value?: boolean
  input?: 'text' | 'month' | 'number' | 'url'
  placeholder?: string
}

export interface ResumeIssue {
  id: string
  kind: string
  severity: 'block' | 'warn' | 'info'
  title: string
  detail: string
  line: number | null
  context: string
  actions: ResumeIssueAction[]
}

export interface ApplySession {
  id: number
  job_id: number
  /** Set when this run applies a Telegram post (then job_id is 0). */
  post_id?: number | null
  resume_version_id: number | null
  status: SessionStatus
  ats_type: string | null
  apply_url: string | null
  fill_plan: FillPlan | null
  jd_snapshot: string | null
  error: string | null
  stage: AppStage | null
  stage_updated_at: string | null
  notes: string | null
  started_at: string
  submitted_at: string | null
  updated_at: string
}

export interface SessionEvent {
  id: number
  session_id: number
  type: string
  actor: 'user' | 'system'
  data: Record<string, unknown> | null
  at: string
}

export interface SessionArtifact {
  id: number
  session_id: number
  kind: string
  step: number | null
  at: string
}

export interface SetupCheck {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  blocks: string
  fix?: { kind: 'install' | 'link' | 'action' | 'info'; target: string; label: string }
}

export interface AnswerBankEntry {
  id: number
  question_raw: string
  question_norm: string
  answer: string
  field_type: string
  ats_type: string | null
  uses: number
  last_used_at: string | null
  created_at: string
}

export interface FactBullet {
  id: string
  latex: string
  text: string
  metrics: string[]
  skills: string[]
  extra?: boolean
}

export interface FactEntry {
  id: string
  kind: 'experience' | 'project'
  title: string
  org: string
  location: string
  dates: string
  stack: string[]
  bullets: FactBullet[]
}

export interface FactBank {
  name: string
  email: string
  phone: string
  summary: string
  skills: { category: string; items: string[] }[]
  experience: FactEntry[]
  projects: FactEntry[]
  inventory_extra: string[]
  all_metrics: string[]
  all_skills: string[]
}

/** User-edited overlay on the facts derived from the base LaTeX. */
export interface FactOverlay {
  extra_bullets: Record<string, { id: string; text: string }[]>
  inventory_extra: string[]
  locked: string[]
}
