import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import ApplicationDetail from '../components/ApplicationDetail'
import { MailIcon, FormIcon, HelpIcon } from '../components/Icons'

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

export default function Applications() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.listApplications({ status: status === 'all' ? '' : status, q })
      setRows(data)
    } finally {
      setLoaded(true)
    }
  }, [status, q])

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  // live: new telegram messages appear without manual refresh
  useEffect(() => {
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  const MethodIcon = ({ method }) =>
    method === 'email' ? <MailIcon /> : method === 'gform' ? <FormIcon /> : <HelpIcon />

  return (
    <>
      <div className="chips">
        {STATUS_CHIPS.map((c) => (
          <button key={c} className={`chip ${status === c ? 'active' : ''}`} onClick={() => setStatus(c)}>
            {c}
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
          {loaded ? 'Nothing here yet. Connect Telegram or paste a job post.' : 'Loading…'}
        </div>
      ) : (
        <div className="app-list">
          {rows.map((r) => (
            <div key={r.id} className="card app-item" onClick={() => setSelected(r.id)}>
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
            </div>
          ))}
        </div>
      )}

      {selected && (
        <ApplicationDetail
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
