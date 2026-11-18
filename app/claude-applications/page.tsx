'use client'

import { useEffect, useMemo, useState } from 'react'

import { timeAgo } from '@/components/career/ui'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { request } from '@/lib/api'
import type { ClaudeApplication, ClaudeAppStatus } from '@/lib/types'

const STATUS: Record<ClaudeAppStatus, [string, string]> = {
  applied: ['Applied', 'ok'],
  needs_you: ['Needs you', 'warn'],
  interview: ['Interview', 'info'],
  offer: ['Offer', 'purple'],
  rejected: ['Rejected', 'bad'],
  skipped: ['Skipped', ''],
}
const ORDER = Object.keys(STATUS) as ClaudeAppStatus[]

type Filter = 'all' | ClaudeAppStatus

export default function ClaudeApplicationsPage() {
  const [rows, setRows] = useState<ClaudeApplication[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const toast = useToast()

  const load = () =>
    request<ClaudeApplication[]>('/api/claude-applications').then(setRows).catch((e) => setErr((e as Error).message))
  useEffect(() => {
    void load()
  }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 }
    for (const r of rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const shown = (rows ?? []).filter((r) => filter === 'all' || r.status === filter)
  const submitted = (rows ?? []).filter((r) => r.status !== 'needs_you' && r.status !== 'skipped')

  const move = async (r: ClaudeApplication, status: ClaudeAppStatus) => {
    try {
      await request(`/api/claude-applications/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      void load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="wide">
      <PageHeader
        large
        title="Applications through Claude"
        sub="Jobs Claude applied to for you on Naukri and company career pages"
      />
      {err && <div className="err-box">{err}</div>}

      <div className="kpis">
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">Submitted</div><div className="k-value">{submitted.length}</div></div>
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">Via Naukri</div><div className="k-value">{submitted.filter((r) => r.platform === 'Naukri').length}</div></div>
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">Needs you</div><div className="k-value">{counts.needs_you ?? 0}</div></div>
        <div className="card kpi" style={{ cursor: 'default' }}><div className="k-label">Interviews</div><div className="k-value">{(counts.interview ?? 0) + (counts.offer ?? 0)}</div></div>
      </div>

      <div className="section">
        <div className="seg multi" role="tablist" aria-label="Filter by status">
          {(['all', ...ORDER] as Filter[]).filter((f) => f === 'all' || counts[f]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : STATUS[f][0]} <span className="seg-count">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        {!rows && !err && <div className="skeleton" />}
        {rows && rows.length === 0 && <p className="muted small">No applications yet. Ask Claude to apply to jobs for you and they'll show up here.</p>}
        <div className="job-cards">
          {shown.map((r) => (
            <div key={r.id} className="job-card" style={{ gridTemplateColumns: '1fr auto', cursor: 'default' }}>
              <div style={{ minWidth: 0 }}>
                <div className="jc-title">
                  {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}
                </div>
                <div className="jc-meta">
                  <span>{r.company}</span>
                  {r.location && <span>{r.location}</span>}
                  {r.experience && <span>{r.experience}</span>}
                  <span>{timeAgo(r.applied_at)}</span>
                </div>
                <div className="jc-tags">
                  <span className="pill">{r.platform}</span>
                  {r.resume && <span className="pill info" title="Resume sent">{r.resume}</span>}
                </div>
                {r.note && <div className="jc-why">{r.note}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                <select value={r.status} onChange={(e) => move(r, e.target.value as ClaudeAppStatus)} aria-label={`Status for ${r.title}`}>
                  {ORDER.map((s) => <option key={s} value={s}>{STATUS[s][0]}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
