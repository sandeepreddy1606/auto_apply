/**
 * Manage multiple resume files with role-based matching.
 *
 * Each resume can be tagged with keywords (e.g. "frontend, react"). When
 * applying to a job, the resume whose keywords match the role is used; if none
 * match, the one marked default is used. Files live in data/resumes/; metadata
 * lives in settings.json under "resumes".
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { ResumeMeta } from '@/lib/types'

import { RESUMES_DIR } from './paths'
import * as settingsStore from './settings'

const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx', '.rtf', '.odt', '.txt'])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export function listResumes(): ResumeMeta[] {
  return settingsStore.load().resumes || []
}

const saveList = (items: ResumeMeta[]): void => {
  settingsStore.save({ resumes: items })
}

const absPath = (item: ResumeMeta): string => path.join(RESUMES_DIR, item.stored)

const fileExists = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

export function addResume(
  originalFilename: string,
  content: Buffer,
  name = '',
  keywords = '',
): ResumeMeta {
  const ext = path.extname(originalFilename || '').toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(
      `Unsupported file type '${ext || 'unknown'}'. Use PDF, DOC, DOCX, RTF, ODT or TXT.`,
    )
  }
  if (!content || content.length === 0) throw new Error('The uploaded file is empty.')
  if (content.length > MAX_BYTES) throw new Error('File too large (max 10 MB).')

  fs.mkdirSync(RESUMES_DIR, { recursive: true })
  const rid = crypto.randomBytes(16).toString('hex')
  const stored = rid + ext
  fs.writeFileSync(path.join(RESUMES_DIR, stored), content)

  const items = listResumes()
  const item: ResumeMeta = {
    id: rid,
    name: (name || '').trim() || originalFilename || 'Resume',
    original: originalFilename || stored,
    stored,
    keywords: (keywords || '').trim(),
    is_default: items.length === 0, // first resume added is the default
    size_kb: Math.round((content.length / 1024) * 10) / 10,
    added_at: new Date().toISOString(),
  }
  items.push(item)
  saveList(items)
  return item
}

export function updateResume(
  rid: string,
  fields: Partial<Pick<ResumeMeta, 'name' | 'keywords' | 'is_default'>>,
): ResumeMeta {
  const items = listResumes()
  const target = items.find((it) => it.id === rid)
  if (!target) throw new Error('Resume not found.')
  if (fields.name !== undefined) {
    target.name = String(fields.name).trim() || target.name
  }
  if (fields.keywords !== undefined) {
    target.keywords = String(fields.keywords).trim()
  }
  if (fields.is_default) {
    for (const it of items) it.is_default = it.id === rid
  }
  saveList(items)
  return target
}

export function deleteResume(rid: string): void {
  const items = listResumes()
  const keep = items.filter((it) => it.id !== rid)
  for (const it of items) {
    if (it.id === rid) {
      try {
        fs.unlinkSync(absPath(it))
      } catch {
        /* file already gone */
      }
    }
  }
  // If the default was removed, promote the first remaining resume.
  if (keep.length && !keep.some((it) => it.is_default)) {
    keep[0].is_default = true
  }
  saveList(keep)
}

export function pathFor(rid: string): string | null {
  const it = listResumes().find((r) => r.id === rid)
  if (!it) return null
  const p = absPath(it)
  return fileExists(p) ? p : null
}

export function filenameFor(rid: string): string {
  const it = listResumes().find((r) => r.id === rid)
  return it?.original || it?.name || 'resume'
}

/**
 * Return the resume metadata best matching the job: keyword match on the role
 * first, then the default. null if there are no resumes on file.
 */
export function pickForJob(jobTitle = '', extraText = ''): ResumeMeta | null {
  const items = listResumes()
  if (!items.length) return null
  const hay = `${jobTitle || ''} ${extraText || ''}`.toLowerCase()
  for (const it of items) {
    const kws = (it.keywords || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
    if (kws.length && kws.some((k) => hay.includes(k)) && fileExists(absPath(it))) {
      return it
    }
  }
  for (const it of items) {
    if (it.is_default && fileExists(absPath(it))) return it
  }
  return null
}
