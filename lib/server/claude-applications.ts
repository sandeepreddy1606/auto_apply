/**
 * Applications Claude submitted for you outside this app (Naukri quick-apply,
 * company career pages), kept as a JSON file next to settings.json.
 */
import fs from 'node:fs'

import type { ClaudeApplication, ClaudeAppStatus } from '@/lib/types'

import { HttpError } from './http'
import { CLAUDE_APPS_PATH } from './paths'
import { writeAtomic } from './settings'

export const STATUSES: ClaudeAppStatus[] = ['applied', 'needs_you', 'interview', 'offer', 'rejected', 'skipped']

export function list(): ClaudeApplication[] {
  if (!fs.existsSync(CLAUDE_APPS_PATH)) return []
  try {
    const rows = JSON.parse(fs.readFileSync(CLAUDE_APPS_PATH, 'utf-8')) as ClaudeApplication[]
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function saveAll(rows: ClaudeApplication[]): void {
  writeAtomic(CLAUDE_APPS_PATH, JSON.stringify(rows, null, 2))
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Add one entry; `title` and `company` are required. */
export function add(input: Record<string, unknown>): ClaudeApplication {
  const title = str(input.title, 200)
  const company = str(input.company, 200)
  if (!title || !company) throw new HttpError(400, 'title and company are required.')
  const status = STATUSES.includes(input.status as ClaudeAppStatus) ? (input.status as ClaudeAppStatus) : 'applied'
  const rows = list()
  const row: ClaudeApplication = {
    id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1,
    title,
    company,
    location: str(input.location, 200),
    experience: str(input.experience, 50),
    platform: str(input.platform, 50) || 'Naukri',
    url: str(input.url, 1000),
    resume: str(input.resume, 200),
    status,
    note: str(input.note, 1000),
    applied_at: str(input.applied_at, 40) || new Date().toISOString(),
  }
  saveAll([...rows, row])
  return row
}

export function update(id: number, patch: Record<string, unknown>): ClaudeApplication {
  const rows = list()
  const row = rows.find((r) => r.id === id)
  if (!row) throw new HttpError(404, 'Application not found.')
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status as ClaudeAppStatus)) throw new HttpError(400, 'Unknown status.')
    row.status = patch.status as ClaudeAppStatus
  }
  if (patch.note !== undefined) row.note = str(patch.note, 1000)
  saveAll(rows)
  return row
}

export function remove(id: number): void {
  const rows = list()
  if (!rows.some((r) => r.id === id)) throw new HttpError(404, 'Application not found.')
  saveAll(rows.filter((r) => r.id !== id))
}
