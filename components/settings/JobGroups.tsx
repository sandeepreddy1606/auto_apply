'use client'

/**
 * Settings → Telegram → Job groups.
 *
 * Type a group's name (or @username / t.me link) to find it among the groups
 * you've joined, pick how far back to read, and watch it: its job posts land
 * in the Telegram inbox, separate from the career-page jobs. Each watched
 * group shows when it was last read and what it found.
 */
import { useCallback, useEffect, useState } from 'react'

import { SearchIcon, SendIcon } from '@/components/Icons'
import { useNavigate } from '@/components/Navigation'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { ChatSync, WatchedChat } from '@/lib/types'

const DAYS: [number, string][] = [[1, 'Today'], [3, 'Last 3 days'], [7, 'Last week'], [14, 'Last 2 weeks'], [30, 'Last month'], [0, 'Only new posts']]

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

export default function JobGroups({ connected, watched, onWatchedChange }: {
  connected: boolean
  watched: WatchedChat[]
  onWatchedChange: (next: WatchedChat[]) => void
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<WatchedChat[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [days, setDays] = useState(3)
  const [busy, setBusy] = useState<string | null>(null)
  const [syncs, setSyncs] = useState<Record<string, ChatSync | null>>({})

  const loadSyncs = useCallback(() => {
    api.tgStatus().then((s) => setSyncs(s.syncs ?? {})).catch(() => {})
  }, [])
  useEffect(loadSyncs, [loadSyncs, watched.length])

  // Search your groups as you type.
  useEffect(() => {
    if (!connected || q.trim().length < 2) {
      setResults(null)
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      api
        .tgChats(q.trim())
        .then((r) => setResults(r.slice(0, 8)))
        .catch((e) => {
          setResults([])
          toast((e as Error).message, 'error')
        })
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q, connected, toast])

  const watch = async (chat: WatchedChat) => {
    setBusy(chat.id)
    try {
      const r = await api.tgAddGroup(chat, days)
      onWatchedChange(r.status.watched_chats)
      setSyncs(r.syncs)
      setQ('')
      setResults(null)
      if (r.error) toast(`Watching ${chat.title}, but reading its history failed: ${r.error}`, 'error')
      else if (days === 0) toast(`Watching ${chat.title}. New job posts will appear in the Telegram inbox.`, 'success')
      else toast(`Watching ${chat.title}: read ${r.fetched.found} message${r.fetched.found === 1 ? '' : 's'}, ${r.fetched.created} new job post${r.fetched.created === 1 ? '' : 's'} in your inbox.`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const checkNow = async (id?: string) => {
    setBusy(id ?? 'all')
    try {
      const r = await api.tgFetch(id)
      setSyncs(r.syncs)
      toast(r.created ? `${r.created} new job post${r.created === 1 ? '' : 's'} in your inbox.` : 'No new job posts since the last check.', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const unwatch = async (chat: WatchedChat) => {
    if (!window.confirm(`Stop watching ${chat.title}? Posts already in your inbox stay.`)) return
    setBusy(chat.id)
    try {
      const r = await api.tgRemoveGroup(chat.id)
      onWatchedChange(r.status.watched_chats)
      setSyncs(r.syncs)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const isWatched = (id: string) => watched.some((w) => String(w.id) === String(id))

  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 6 }}>
        <h3 style={{ marginBottom: 0 }}><SendIcon style={{ width: 17, height: 17 }} /> Job groups</h3>
        {connected && watched.length > 0 && (
          <button className="btn sm" disabled={busy !== null} onClick={() => checkNow()}>
            {busy === 'all' ? <span className="spin" /> : null} Check all now
          </button>
        )}
      </div>
      <p className="muted small" style={{ marginBottom: 14 }}>
        Groups and channels you’ve joined that post jobs. Their posts go to the{' '}
        <button className="link-btn" onClick={() => navigate('/applications')}>Telegram inbox</button>, kept apart from career-page jobs.
      </p>

      {!connected ? (
        <p className="warn-text">Connect Telegram above first, then add your job groups here.</p>
      ) : (
        <div className="grp-add">
          <div className="search-input">
            <SearchIcon />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Group name, @username or t.me link" aria-label="Find a group" />
          </div>
          <label className="field grp-days">
            <span className="lbl">When added, read</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
            </select>
          </label>
        </div>
      )}

      {connected && q.trim().length >= 2 && (
        <div className="grp-results">
          {searching && !results && <p className="muted small">Searching your chats…</p>}
          {results && results.length === 0 && <p className="muted small">No group you’ve joined matches “{q}”. Check the name, or join the group in Telegram first.</p>}
          {results?.map((c) => (
            <div key={c.id} className="grp-row">
              <div className="grp-main">
                <b>{c.title}</b>
                <span className="muted small">{c.kind === 'group' ? 'Group' : 'Channel'}{c.username ? `, @${c.username}` : ', private'}</span>
              </div>
              {isWatched(c.id) ? (
                <span className="pill ok">Watching</span>
              ) : (
                <button className="btn sm primary" disabled={busy !== null} onClick={() => watch(c)}>
                  {busy === c.id ? <><span className="spin" /> Reading posts…</> : 'Watch'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {watched.length > 0 && (
        <div className="grp-list">
          {watched.map((c) => {
            const sy = syncs[c.id]
            return (
              <div key={c.id} className="grp-row">
                <div className="grp-main">
                  <b>{c.title}</b>
                  <span className={`small ${sy?.error ? 'error-text' : 'muted'}`}>
                    {sy?.error
                      ? `Last check failed: ${sy.error}`
                      : sy?.last_fetch_at
                        ? `Checked ${ago(sy.last_fetch_at)}: ${sy.last_fetch_found} message${sy.last_fetch_found === 1 ? '' : 's'}, ${sy.last_fetch_new} new post${sy.last_fetch_new === 1 ? '' : 's'}`
                        : 'Listening for new posts'}
                  </span>
                </div>
                <div className="grp-actions">
                  <button className="btn sm" disabled={!connected || busy !== null} onClick={() => checkNow(c.id)}>
                    {busy === c.id ? <span className="spin" /> : null} Check now
                  </button>
                  <button className="btn sm ghost" disabled={busy !== null} onClick={() => unwatch(c)}>Stop watching</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {connected && watched.length === 0 && !q && (
        <p className="muted small">No groups yet. Type the name of a job group you’ve joined.</p>
      )}
    </div>
  )
}
