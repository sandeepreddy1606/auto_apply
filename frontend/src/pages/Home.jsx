import { useEffect, useState } from 'react'
import { api } from '../api'
import { Sliders, PlusSquare, SendIcon, ChevronRight } from '../components/Icons'
import IngestModal from '../components/IngestModal'

function relTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function MonthDots({ year, month, counts }) {
  const label = new Date(year, month, 1).toLocaleString('en', { month: 'short' })
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) {
    cells.push(<span key={`pad${i}`} className="dot" style={{ opacity: 0 }} />)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const c = counts[key] || 0
    cells.push(<span key={d} className={`dot ${c >= 2 ? 'l2' : c === 1 ? 'l1' : ''}`} />)
  }
  return (
    <div className="month">
      <div className="m-label">{label}</div>
      <div className="dots">{cells}</div>
    </div>
  )
}

export default function Home({ tg, onOpenApps, onOpenSettings }) {
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState({})
  const [recent, setRecent] = useState([])
  const [ingestOpen, setIngestOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [st, act, apps] = await Promise.all([
          api.stats(), api.activity(), api.listApplications(),
        ])
        if (!alive) return
        setStats(st)
        setActivity(act)
        setRecent(apps)
      } catch { /* backend warming up */ }
    }
    load()
    const t = setInterval(load, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const s = stats?.by_status || {}
  const review = s.review || 0
  const applied = s.applied || 0
  const total = stats?.total || 0
  const pct = total ? Math.min(1, review / total) : 0
  const latest = recent[0]
  const latestPending = recent.find((r) => r.status === 'review')

  const now = new Date()
  const months = [2, 1, 0].map((back) => {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  const R = 27
  const CIRC = 2 * Math.PI * R

  return (
    <>
      {tg.state !== 'connected' && (
        <div className="card connect-card" onClick={onOpenSettings}>
          <span className="c-icon"><SendIcon style={{ width: 20, height: 20 }} /></span>
          <div>
            <div className="c-title">Connect Telegram</div>
            <div className="c-sub">Job posts from your private channels will land here automatically.</div>
          </div>
          <ChevronRight className="chev" style={{ width: 18, height: 18 }} />
        </div>
      )}

      <div className="widget-row">
        <div className="card widget" onClick={onOpenApps}>
          <span className="corner"><Sliders /></span>
          <div className="ring">
            <svg className="track" width="62" height="62">
              <circle cx="31" cy="31" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
              <circle
                cx="31" cy="31" r={R} fill="none" stroke="#fff" strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0.03, pct) * CIRC} ${CIRC}`}
              />
            </svg>
            {review}
          </div>
          <div>
            <div className="w-title">Needs review</div>
            <div className="w-sub">
              {latestPending ? latestPending.job_title || 'Untitled post' : 'Queue is clear'}
            </div>
          </div>
        </div>

        <div className="card widget" onClick={onOpenApps}>
          <span className="corner"><Sliders /></span>
          <div className="big-num">
            {applied}<span className="unit">jobs</span>
          </div>
          <div>
            <div className="w-title">Applied</div>
            <div className="w-sub">
              {stats?.last_applied_at ? relTime(stats.last_applied_at) : 'nothing sent yet'}
            </div>
          </div>
        </div>
      </div>

      <div className="card activity-card" onClick={onOpenApps}>
        <div className="months">
          {months.map((m) => (
            <MonthDots key={`${m.year}-${m.month}`} year={m.year} month={m.month} counts={activity} />
          ))}
        </div>
        <div className="activity-foot">
          <span className="badge-circle">{total}</span>
          <div>
            <div className="f-title">
              {latest ? latest.job_title || 'New message' : 'No messages yet'}
            </div>
            <div className="f-sub">
              {latest
                ? `${latest.channel || latest.source} · ${relTime(latest.created_at)}`
                : 'Incoming posts show up here'}
            </div>
          </div>
          <span className="corner-inline"><Sliders style={{ width: 18, height: 18 }} /></span>
        </div>
      </div>

      <div className="card stat-row" onClick={onOpenApps}>
        <div>
          <div className="s-title">Applications sent</div>
          <div className="s-sub">Last 7 days</div>
        </div>
        <div className="s-num">
          {stats?.applied_7d ?? 0}<span className="unit">jobs</span>
        </div>
        <span className="corner-inline"><Sliders style={{ width: 18, height: 18 }} /></span>
      </div>

      <button className="square-btn" onClick={() => setIngestOpen(true)} title="Paste a job message">
        <PlusSquare />
      </button>

      {ingestOpen && (
        <IngestModal
          onClose={() => setIngestOpen(false)}
          onDone={() => { setIngestOpen(false); onOpenApps() }}
        />
      )}
    </>
  )
}
