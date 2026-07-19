import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { useToast } from '../Toast'
import PageHeader from '../components/PageHeader'
import { MailIcon, FormIcon, HelpIcon, PlusSquare, ChevronRight, BoltIcon, LinkIcon } from '../components/Icons'

const STATUS_CHIPS = ['all', 'review', 'applied', 'failed', 'manual', 'skipped']

function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// A post can be fired off with one click when it has a method and a destination,
// and hasn't been applied/skipped yet.
const isReady = (r) =>
  ['review', 'failed'].includes(r.status) &&
  ((r.method === 'email' && r.email_to) || (r.method === 'gform' && r.form_url))

export default function Applications() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [counts, setCounts] = useState({})
  const [applying, setApplying] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [data, st] = await Promise.all([
        api.listApplications({ status: status === 'all' ? '' : status, q }),
        api.stats().catch(() => null),
      ])
      setRows(data)
      if (st) setCounts({ all: st.total, ...st.by_status })
    } catch { /* backend warming up */ } finally {
      setLoaded(true)
    }
  }, [status, q])

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  // live: new telegram messages appear without manual refresh (paused mid-apply
  // so an in-flight result isn't clobbered by a poll)
  useEffect(() => {
    const t = setInterval(() => {
      if (applying.size === 0 && !bulkBusy) load()
    }, 10000)
    return () => clearInterval(t)
  }, [load, applying, bulkBusy])

  const setBusy = (id, on) => setApplying((prev) => {
    const next = new Set(prev)
    if (on) next.add(id); else next.delete(id)
    return next
  })

  const quickApply = async (r) => {
    // Google Forms: open the pre-filled draft so the user can review / complete
    // the fields we couldn't auto-fill, then submit there.
    if (r.method === 'gform') { navigate(`/applications/${r.id}?apply=1`); return }
    // Email: fire it off directly.
    if (!window.confirm(`Apply to "${r.job_title || 'this post'}" now?\n\nThis sends the application email automatically.`)) return
    setBusy(r.id, true)
    try {
      const updated = await api.apply(r.id)
      if (updated.status === 'applied') toast(`Applied to ${updated.job_title || 'the post'}.`, 'success')
      else toast(`Couldn’t apply: ${updated.error || 'unknown error'}`, 'error')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(r.id, false)
      load()
    }
  }

  const ready = rows.filter(isReady)
  const bulkApply = async () => {
    if (ready.length === 0) return
    if (!window.confirm(
      `Automatically apply to ${ready.length} ready job${ready.length > 1 ? 's' : ''} now?\n\n` +
      `Emails will be sent and Google Forms submitted for every one. This can’t be undone.`)) return
    setBulkBusy(true)
    try {
      const res = await api.applyBatch(ready.map((r) => r.id))
      const other = res.total - res.applied - (res.needs_input || 0)
      const bits = [`Applied to ${res.applied} of ${res.total}`]
      if (res.needs_input) bits.push(`${res.needs_input} need details — open to complete`)
      if (other > 0) bits.push(`${other} couldn’t be sent`)
      toast(bits.join(' · ') + '.', res.applied === res.total ? 'success' : 'error')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBulkBusy(false)
      load()
    }
  }

  const MethodIcon = ({ method }) =>
    method === 'email' ? <MailIcon /> : method === 'gform' ? <FormIcon />
      : method === 'link' ? <LinkIcon /> : <HelpIcon />

  return (
    <>
      <PageHeader large title="Jobs"
        sub="Posts from Telegram & pasted messages — apply in one tap"
        actions={
          <button className="icon-btn" onClick={() => navigate('/paste')} title="Paste a job message">
            <PlusSquare />
          </button>
        } />

      {ready.length > 0 && (
        <div className="card bulk-bar">
          <div>
            <div className="bulk-title">{ready.length} job{ready.length > 1 ? 's' : ''} ready to apply</div>
            <div className="bulk-sub">Auto-fills and sends each one — email or Google Form</div>
          </div>
          <button className="btn primary" disabled={bulkBusy || applying.size > 0} onClick={bulkApply}>
            <BoltIcon style={{ width: 16, height: 16, marginRight: 6, verticalAlign: '-3px' }} />
            {bulkBusy ? 'Applying…' : 'Apply all'}
          </button>
        </div>
      )}

      <div className="chips">
        {STATUS_CHIPS.map((c) => (
          <button key={c} className={`chip ${status === c ? 'active' : ''}`} onClick={() => setStatus(c)}>
            {c} {counts[c] > 0 && <span className="chip-n">{counts[c]}</span>}
          </button>
        ))}
      </div>
      <div className="search-wrap">
        <input
          type="search"
          placeholder="Search role, company, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {!loaded ? 'Loading…' : q || status !== 'all' ? (
            'Nothing matches this filter.'
          ) : (
            <>
              <p style={{ marginBottom: 14 }}>Nothing here yet.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={() => navigate('/paste')}>Paste a job post</button>
                <button className="btn" onClick={() => navigate('/settings/telegram')}>Connect Telegram</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="app-list">
          {rows.map((r) => {
            const busy = applying.has(r.id)
            return (
              <div key={r.id} className="card app-item" onClick={() => navigate(`/applications/${r.id}`)}>
                <span className="method-ico"><MethodIcon method={r.method} /></span>
                <div className="a-body">
                  <div className="a-title">{r.job_title || 'Untitled post'}</div>
                  <div className="a-sub">
                    {[r.company, r.location, r.channel || r.source].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="a-side">
                  <span className={`badge ${r.status}`}>{r.status}</span>
                  <span className="a-time">{relTime(r.created_at)}</span>
                </div>
                {isReady(r) ? (
                  <button className="btn sm apply-btn" disabled={busy || bulkBusy}
                    onClick={(e) => { e.stopPropagation(); quickApply(r) }}>
                    {busy ? '…' : 'Apply'}
                  </button>
                ) : r.method === 'link' && r.apply_url && r.status !== 'applied' ? (
                  <a className="btn sm apply-btn" href={r.apply_url} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}>Open ↗</a>
                ) : null}
                <ChevronRight style={{ width: 16, height: 16, color: 'var(--dim-2)', flexShrink: 0 }} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
