'use client'

/**
 * Ctrl/⌘ K: jump anywhere — pages, settings sections, quick actions — or find
 * a job by title or company. Keyboard first: ↑ ↓ to move, Enter to open, Esc to close.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'

import { career } from '@/lib/career-api'
import type { JobListItem } from '@/lib/types'

import {
  BoltIcon, BriefcaseIcon, BuildingIcon, DocIcon, FormIcon, GearIcon, GridIcon, HeartbeatIcon, KanbanIcon,
  ListIcon, LockIcon, MailIcon, MoonIcon, PlusSquare, SearchIcon, SendIcon, SparkIcon, SunIcon, TargetIcon,
} from './Icons'
import { useNavigate } from './Navigation'
import { applyTheme } from './Theme'

type Icon = ComponentType<SVGProps<SVGSVGElement>>
interface Item { id: string; group: string; label: string; sub?: string; Icon: Icon; run: () => void }

const PAGES: [string, string, Icon, string?][] = [
  ['/', 'Overview', GridIcon],
  ['/jobs', 'Jobs', BriefcaseIcon, 'Matches from career pages'],
  ['/tracker', 'Applications', KanbanIcon, 'Everything you applied to'],
  ['/companies', 'Companies', BuildingIcon, 'Openings and watched career pages'],
]
const SETTINGS: [string, string, Icon][] = [
  ['/settings/setup', 'Setup & health', HeartbeatIcon],
  ['/settings/preferences', 'Job preferences', TargetIcon],
  ['/settings/resume', 'Resume (LaTeX)', DocIcon],
  ['/settings/resumes', 'Resumes (PDF)', DocIcon],
  ['/settings/answers', 'Application answers', FormIcon],
  ['/settings/profile', 'Profile', ListIcon],
  ['/settings/ai', 'AI', SparkIcon],
  ['/settings/apply', 'Apply automation', BoltIcon],
  ['/settings/email', 'Email (password reset)', MailIcon],
  ['/settings/security', 'Account & security', LockIcon],
]

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    setJobs([])
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // Job search, debounced.
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setJobs([])
      return
    }
    const t = setTimeout(() => {
      career.jobs({ q: q.trim(), view: 'all', sort: 'score', limit: 6 }).then((r) => setJobs(r.items)).catch(() => setJobs([]))
    }, 180)
    return () => clearTimeout(t)
  }, [q, open])

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      onClose()
      navigate(to)
    }
    const all: Item[] = [
      ...PAGES.map(([to, label, Icon, sub]) => ({ id: to, group: 'Go to', label, sub, Icon, run: go(to) })),
      { id: 'act-company', group: 'Actions', label: 'Add a company career page', Icon: BuildingIcon, run: go('/companies') },
      { id: 'act-light', group: 'Actions', label: 'Switch to light theme', Icon: SunIcon, run: () => { applyTheme('light'); onClose() } },
      { id: 'act-dark', group: 'Actions', label: 'Switch to dark theme', Icon: MoonIcon, run: () => { applyTheme('dark'); onClose() } },
      ...SETTINGS.map(([to, label, Icon]) => ({ id: to, group: 'Settings', label, Icon, run: go(to) })),
    ]
    const needle = q.trim().toLowerCase()
    const filtered = needle ? all.filter((i) => `${i.label} ${i.sub ?? ''} ${i.group}`.toLowerCase().includes(needle)) : all
    const jobItems: Item[] = jobs.map((j) => ({
      id: `job-${j.id}`,
      group: 'Jobs',
      label: j.title,
      sub: [j.company_name, j.location?.split(',')[0]].filter(Boolean).join(', '),
      Icon: BriefcaseIcon,
      run: go(`/jobs/${j.id}`),
    }))
    return [...jobItems, ...filtered]
  }, [q, jobs, navigate, onClose])

  useEffect(() => setSel(0), [q, jobs.length])
  useEffect(() => {
    listRef.current?.querySelector('.cmdk-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(items.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[sel]?.run()
    }
  }

  let lastGroup = ''
  return (
    <div className="cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search and jump" onKeyDown={onKey}>
        <div className="cmdk-input">
          <SearchIcon />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs, pages and settings…"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {items.length === 0 && <div className="cmdk-empty">Nothing matches “{q}”.</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <div key={it.id}>
                {head && <div className="cmdk-group">{head}</div>}
                <button
                  className={`cmdk-item ${i === sel ? 'on' : ''}`}
                  role="option"
                  aria-selected={i === sel}
                  onMouseMove={() => setSel(i)}
                  onClick={it.run}
                >
                  <it.Icon />
                  <span className="truncate">{it.label}</span>
                  {it.sub && <span className="ci-sub">{it.sub}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Ctrl</kbd> <kbd>K</kbd> anywhere</span>
        </div>
      </div>
    </div>
  )
}
