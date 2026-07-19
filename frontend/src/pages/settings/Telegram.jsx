import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useToast } from '../../Toast'
import PageHeader from '../../components/PageHeader'
import { Input, useSection, useGuardedBack, SaveBar, LoadError, validateTelegram } from './shared'

export default function TelegramPage({ tg, setTg }) {
  const s = useSection('telegram', validateTelegram)
  const back = useGuardedBack(s.dirty)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [chats, setChats] = useState(null)
  const [chatQuery, setChatQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // A loaded channel list is only meaningful while connected — drop it on
  // disconnect so the picker and its live checkboxes disappear too.
  useEffect(() => {
    if (tg.state !== 'connected') { setChats(null); setChatQuery('') }
  }, [tg.state])

  if (s.loadError) return <><PageHeader title="Telegram" backTo="/settings" /><LoadError message={s.loadError} onRetry={s.load} /></>
  if (!s.data) return <><PageHeader title="Telegram" backTo="/settings" /><p className="muted">Loading…</p></>

  const t = s.data

  const tgAction = async (fn) => {
    setBusy(true)
    try {
      const saved = await api.saveSettings({ telegram: t })
      s.markSaved(saved.telegram)
      const status = await fn()
      setTg(status)
      if (status.state === 'error') toast(status.error || 'Telegram error', 'error')
      if (status.state === 'connected') {
        toast('Telegram connected — listening for job posts.', 'success')
        setCode(''); setPassword('')
        loadChats()
      }
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const loadChats = async () => {
    try {
      setChats(await api.tgChats())
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const watched = t.watched_chats || []
  const toggleChat = (chat) => {
    const exists = watched.some((c) => String(c.id) === String(chat.id))
    const next = exists ? watched.filter((c) => String(c.id) !== String(chat.id)) : [...watched, chat]
    // Persisted immediately — update only this key in data + baseline so any
    // unsaved credential edits keep showing as unsaved.
    s.markKeySaved('watched_chats', next)
    api.tgWatch(next).catch((e) => toast(e.message, 'error'))
  }
  const visibleChats = (chats || []).filter(
    (c) => !chatQuery || (c.title || '').toLowerCase().includes(chatQuery.toLowerCase()),
  )

  return (
    <>
      <PageHeader title="Telegram" sub="Where job posts come from" onBack={back} />

      <div className="settings-stack">
        <div className="card">
          <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            Connects with <strong>your own account</strong>, so posts from private channels
            you're a member of arrive automatically — no pasting, no bot required. Get{' '}
            <strong>api_id</strong> / <strong>api_hash</strong> from{' '}
            <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a>
            {' '}→ API development tools.
          </p>
          <div className="grid-2">
            <Input label="API ID" value={t.api_id} onChange={s.set('api_id')} error={s.errors.api_id} />
            <Input label="API hash" type="password" value={t.api_hash} onChange={s.set('api_hash')} />
            <Input label="Phone (+91…)" value={t.phone} onChange={s.set('phone')} error={s.errors.phone} />
          </div>

          <div className="row-actions">
            {tg.state !== 'connected' && (
              <button className="btn primary" disabled={busy} onClick={() => tgAction(api.tgConnect)}>
                {busy ? 'Working…' : 'Connect Telegram'}
              </button>
            )}
            {tg.state === 'connected' && (
              <>
                <span className="success-text">● Connected — listening</span>
                <button className="btn sm" onClick={loadChats}>{chats ? 'Refresh channels' : 'Load my channels'}</button>
                <button className="btn sm danger" disabled={busy} onClick={() => tgAction(api.tgDisconnect)}>Disconnect</button>
              </>
            )}
          </div>

          {tg.state === 'awaiting_code' && (
            <div className="row-actions">
              <input style={{ maxWidth: 200 }} placeholder="Login code from Telegram" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn primary" disabled={busy || !code.trim()} onClick={() => tgAction(() => api.tgCode(code.trim()))}>Verify</button>
            </div>
          )}
          {tg.state === 'awaiting_password' && (
            <div className="row-actions">
              <input style={{ maxWidth: 200 }} type="password" placeholder="2FA password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button className="btn primary" disabled={busy || !password} onClick={() => tgAction(() => api.tgPassword(password))}>Verify</button>
            </div>
          )}
          {tg.state === 'error' && tg.error && <p className="error-text" style={{ marginTop: 12 }}>⚠ {tg.error}</p>}
        </div>

        <div className="card">
          <h3>Watched channels</h3>
          {tg.state !== 'connected' && (
            <p className="muted" style={{ fontSize: 13 }}>Connect first, then pick the channels that post jobs.</p>
          )}
          {tg.state === 'connected' && watched.length === 0 && (
            <p className="warn-text" style={{ marginBottom: 10 }}>
              No channels are being watched yet — load your channels and tick the ones with job posts.
            </p>
          )}
          {watched.length > 0 && (
            <p style={{ fontSize: 13, marginBottom: 4 }} className="muted">
              Watching {watched.length}: <span style={{ color: 'var(--text)' }}>{watched.map((c) => c.title).join(', ')}</span>
            </p>
          )}
          {tg.state === 'connected' && !chats && (
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={loadChats}>Load my channels</button>
            </div>
          )}
          {chats && (
            <>
              {chats.length > 6 && (
                <div className="search-wrap" style={{ marginTop: 12 }}>
                  <input placeholder={`Search ${chats.length} channels…`} value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)} />
                </div>
              )}
              <div className="chat-list">
                {visibleChats.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No channels match.</p>}
                {visibleChats.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={watched.some((w) => String(w.id) === String(c.id))}
                      onChange={() => toggleChat(c)}
                    />
                    {c.title}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <button className="btn primary" style={{ padding: '15px', fontSize: 15 }}
          disabled={s.saving || !s.dirty} onClick={s.save}>
          {s.saving ? 'Saving…' : s.dirty ? 'Save Telegram settings' : 'All changes saved'}
        </button>
      </div>

      <SaveBar dirty={s.dirty} saving={s.saving} errorCount={s.errorCount}
        onSave={s.save} onDiscard={s.discard} />
    </>
  )
}
