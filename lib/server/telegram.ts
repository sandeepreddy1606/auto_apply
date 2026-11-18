/**
 * Telegram integration via teleproto (the maintained GramJS fork) — user
 * session, MTProto.
 *
 * A user session — not a bot — is used so private channels the user is a member
 * of can be read. Login happens through the UI: phone -> code -> (optional 2FA
 * password). The session string is persisted to data/telegram.session.txt so
 * subsequent starts reconnect silently.
 *
 * The login flow is callback-driven: `signInUser` asks for the code (and then
 * the password) via async callbacks. Those callbacks return deferred promises
 * that the corresponding HTTP endpoints resolve, which turns the library's
 * interactive flow into the stateless request/response flow the UI expects.
 */
import fs from 'node:fs'

import type { ChatSync, TelegramStatus, WatchedChat } from '@/lib/types'

import { TELEGRAM_SESSION_PATH } from './paths'
import * as settingsStore from './settings'
import { messageText } from './telegram-text'
import type { TgMessageLike } from './telegram-text'

const log = (...args: unknown[]) => console.log('[autoapply.telegram]', ...args)

/** Where a post came from; `live` is false for history fetched after the fact. */
export interface PostMeta {
  chatId: string
  messageId: number | null
  postedAt: string | null
  live: boolean
}

/** Stores one message; returns how many new posts it created. */
type IngestFn = (text: string, channel: string, meta: PostMeta) => Promise<number>

type TgMessage = TgMessageLike & { id?: number; date?: number }

interface DialogLike {
  isChannel?: boolean
  isGroup?: boolean
  title?: string
  id?: { toString(): string }
  entity?: { username?: string | null; megagroup?: boolean; broadcast?: boolean } & Record<string, unknown>
}

const SYNC_KEY = (chatId: string) => `tg.sync:${chatId}`
const MAX_HISTORY = 400

async function readSync(chatId: string): Promise<ChatSync | null> {
  const { kvGet } = await import('@/lib/tasks/queue')
  return (await kvGet<ChatSync>(SYNC_KEY(chatId)))?.value ?? null
}

async function writeSync(chatId: string, patch: Partial<ChatSync>): Promise<void> {
  const { kvSet } = await import('@/lib/tasks/queue')
  const cur = (await readSync(chatId)) ?? { last_message_id: 0, last_fetch_at: null, last_fetch_found: 0, last_fetch_new: 0, error: null }
  await kvSet(SYNC_KEY(chatId), { ...cur, ...patch, last_message_id: Math.max(cur.last_message_id, patch.last_message_id ?? 0) })
}

/** Sync state for every watched group (for Settings → Telegram). */
export async function chatSyncs(): Promise<Record<string, ChatSync | null>> {
  const out: Record<string, ChatSync | null> = {}
  for (const c of settingsStore.load().telegram.watched_chats || []) out[c.id] = await readSync(String(c.id))
  return out
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type State = TelegramStatus['state']

/** States that mean "the flow has paused and the UI can act". */
const SETTLED: ReadonlySet<State> = new Set<State>([
  'awaiting_code',
  'awaiting_password',
  'connected',
  'error',
  'disconnected',
])

const SETTLE_TIMEOUT_MS = 30_000

// teleproto is CommonJS and pulls in a large dependency tree; importing it
// lazily keeps it out of request paths that never touch Telegram.
type AnyClient = {
  connect(): Promise<boolean>
  disconnect(): Promise<void>
  isUserAuthorized(): Promise<boolean>
  signInUser(creds: { apiId: number; apiHash: string }, params: unknown): Promise<unknown>
  getDialogs(params?: unknown): Promise<unknown[]>
  getMessages(entity: unknown, params?: unknown): Promise<unknown[]>
  addEventHandler(cb: (event: unknown) => unknown, filter?: unknown): void
  session: { save(): string }
}

// Imported from the package root, not `teleproto/events` / `teleproto/sessions`:
// the package ships no "exports" map, so subpath requests defeat Next's
// serverExternalPackages and get bundled (which breaks its dynamic requires).
async function loadTeleproto() {
  const mod = await import('teleproto')
  return {
    TelegramClient: mod.TelegramClient as unknown as new (
      session: unknown,
      apiId: number,
      apiHash: string,
      opts: Record<string, unknown>,
    ) => AnyClient,
    StringSession: mod.sessions.StringSession as unknown as new (s: string) => unknown,
    NewMessage: mod.events.NewMessage as unknown as new (
      opts: Record<string, unknown>,
    ) => unknown,
  }
}

function readSavedSession(): string {
  try {
    return fs.readFileSync(TELEGRAM_SESSION_PATH, 'utf-8').trim()
  } catch {
    return ''
  }
}

function writeSavedSession(value: string): void {
  try {
    fs.writeFileSync(TELEGRAM_SESSION_PATH, value, { encoding: 'utf-8', mode: 0o600 })
  } catch (e) {
    console.warn('[autoapply.telegram] could not persist session:', (e as Error).message)
  }
}

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

class TelegramManager {
  client: AnyClient | null = null
  state: State = 'disconnected'
  error: string | null = null
  phone: string | null = null

  #ingest: IngestFn | null = null
  #handlerRegistered = false
  #loginInFlight = false
  #codeDeferred: Deferred<string> | null = null
  #passwordDeferred: Deferred<string> | null = null
  #settleWaiters: (() => void)[] = []
  #catchUpTimer: ReturnType<typeof setInterval> | null = null
  #fetching = new Set<string>()

  setIngestCallback(cb: IngestFn): void {
    this.#ingest = cb
  }

  status(): TelegramStatus {
    const watched = settingsStore.load().telegram.watched_chats || []
    return { state: this.state, error: this.error, watched_chats: watched }
  }

  #setState(state: State, error: string | null = null): void {
    this.state = state
    this.error = error
    if (SETTLED.has(state)) {
      const waiters = this.#settleWaiters
      this.#settleWaiters = []
      for (const w of waiters) w()
    }
  }

  /** Resolve once the login flow next pauses, or after a timeout. */
  #waitForSettle(): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, SETTLE_TIMEOUT_MS)
      // Node keeps the process alive for pending timers; this one is short-lived
      // but there is no reason to hold the loop open for it.
      if (typeof timer.unref === 'function') timer.unref()
      this.#settleWaiters.push(finish)
    })
  }

  async #ensureClient(): Promise<AnyClient> {
    const cfg = settingsStore.load().telegram
    const apiId = String(cfg.api_id || '').trim()
    const apiHash = String(cfg.api_hash || '').trim()
    if (!apiId || !apiHash) {
      throw new Error(
        'Telegram api_id / api_hash are not set. Get them from my.telegram.org and save in Settings.',
      )
    }
    if (this.client === null) {
      const { TelegramClient, StringSession } = await loadTeleproto()
      this.client = new TelegramClient(
        new StringSession(readSavedSession()),
        Number.parseInt(apiId, 10),
        apiHash,
        { connectionRetries: 5, autoReconnect: true },
      )
    }
    await this.client.connect()
    return this.client
  }

  /**
   * Connect; if the saved session is authorized start listening, otherwise send
   * a login code to the configured phone and pause for the UI to supply it.
   */
  async connect(): Promise<TelegramStatus> {
    this.error = null
    try {
      const client = await this.#ensureClient()
      if (await client.isUserAuthorized()) {
        this.#onAuthorized()
        return this.status()
      }
      const cfg = settingsStore.load().telegram
      const phone = String(cfg.phone || '').trim()
      if (!phone) throw new Error('Telegram phone number is not set in Settings.')
      this.phone = phone

      if (!this.#loginInFlight) {
        this.#startLogin(client, cfg.api_id, cfg.api_hash, phone)
      }
      await this.#waitForSettle()
    } catch (e) {
      this.#setState('error', errMessage(e))
    }
    return this.status()
  }

  /**
   * Drives signInUser in the background. Its callbacks park on deferreds that
   * submitCode / submitPassword resolve.
   */
  #startLogin(client: AnyClient, apiId: string, apiHash: string, phone: string): void {
    this.#loginInFlight = true
    this.#codeDeferred = deferred<string>()
    this.#passwordDeferred = deferred<string>()

    void client
      .signInUser(
        { apiId: Number.parseInt(String(apiId), 10), apiHash: String(apiHash) },
        {
          phoneNumber: async () => phone,
          phoneCode: async () => {
            this.#setState('awaiting_code')
            return this.#codeDeferred!.promise
          },
          password: async () => {
            this.#setState('awaiting_password')
            return this.#passwordDeferred!.promise
          },
          onError: async (err: Error) => {
            this.#setState('error', errMessage(err))
            return true // stop the auth operation
          },
        },
      )
      .then(() => {
        this.#onAuthorized()
      })
      .catch((e) => {
        // onError already reported most failures; this catches the rest.
        if (this.state !== 'error') this.#setState('error', errMessage(e))
      })
      .finally(() => {
        this.#loginInFlight = false
        this.#codeDeferred = null
        this.#passwordDeferred = null
      })
  }

  async submitCode(code: string): Promise<TelegramStatus> {
    this.error = null
    if (!this.#codeDeferred) {
      this.#setState('error', 'No login is in progress — press Connect again.')
      return this.status()
    }
    this.#codeDeferred.resolve(code.trim())
    await this.#waitForSettle()
    return this.status()
  }

  async submitPassword(password: string): Promise<TelegramStatus> {
    this.error = null
    if (!this.#passwordDeferred) {
      this.#setState('error', 'No login is in progress — press Connect again.')
      return this.status()
    }
    this.#passwordDeferred.resolve(password)
    await this.#waitForSettle()
    return this.status()
  }

  #onAuthorized(): void {
    if (this.client) writeSavedSession(this.client.session.save())
    this.#registerHandler()
    this.#setState('connected')
    log('Telegram connected, listener active')
    // Pick up what was posted while the app was off, then keep checking in
    // case the connection dropped silently for a while.
    void this.catchUp().catch((e) => log('catch-up failed:', errMessage(e)))
    if (!this.#catchUpTimer) {
      this.#catchUpTimer = setInterval(() => {
        if (this.state === 'connected') void this.catchUp().catch(() => {})
      }, 15 * 60_000)
      if (typeof this.#catchUpTimer.unref === 'function') this.#catchUpTimer.unref()
    }
  }

  #registerHandler(): void {
    if (this.#handlerRegistered || this.client === null) return
    const client = this.client

    void loadTeleproto().then(({ NewMessage }) => {
      client.addEventHandler(async (event: unknown) => {
        try {
          const watched = settingsStore.load().telegram.watched_chats || []
          const watchedIds = new Set(watched.map((c) => String(c.id)))
          if (watchedIds.size === 0) return // nothing selected -> ignore everything

          const ev = event as {
            chatId?: { toString(): string }
            message?: TgMessage
            getChat?: () => Promise<unknown>
          }
          const chatId = ev.chatId ? String(ev.chatId) : ''
          if (!watchedIds.has(chatId)) return

          // Includes links hidden behind words and URL buttons.
          const text = ev.message ? messageText(ev.message) : ''
          if (!text.trim()) return

          let title = chatId
          try {
            const chat = (await ev.getChat?.()) as
              | { title?: string; username?: string }
              | undefined
            title = chat?.title || chat?.username || chatId
          } catch {
            /* fall back to the raw id */
          }
          const messageId = typeof ev.message?.id === 'number' ? ev.message.id : null
          if (this.#ingest) {
            await this.#ingest(text, title, {
              chatId,
              messageId,
              postedAt: ev.message?.date ? new Date(ev.message.date * 1000).toISOString() : new Date().toISOString(),
              live: true,
            })
          }
          if (messageId) await writeSync(chatId, { last_message_id: messageId })
        } catch (e) {
          console.error(
            '[autoapply.telegram] Failed handling incoming telegram message:',
            e,
          )
        }
      }, new NewMessage({}))
      this.#handlerRegistered = true
    })
  }

  async #dialogs(): Promise<DialogLike[]> {
    const client = await this.#ensureClient()
    if (!(await client.isUserAuthorized())) {
      throw new Error('Telegram is not connected yet. Connect it in Settings → Telegram first.')
    }
    return (await client.getDialogs({ limit: 500 })) as DialogLike[]
  }

  /**
   * Your groups and channels, optionally narrowed by name. Matching ignores
   * case, emoji and punctuation, accepts @username and t.me/… links, and puts
   * exact and starts-with matches first.
   */
  async listChats(query = ''): Promise<WatchedChat[]> {
    const dialogs = await this.#dialogs()
    const fold = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const q = fold(query.replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '').replace(/^@/, ''))
    const chats: (WatchedChat & { rank: number })[] = []
    for (const d of dialogs) {
      if (!(d.isChannel || d.isGroup) || d.id == null) continue
      const title = d.title || String(d.id)
      const username = (d.entity?.username as string | undefined) || null
      const kind = d.isGroup || d.entity?.megagroup ? 'group' : 'channel'
      let rank = 0
      if (q) {
        const t = fold(title)
        const u = fold(username || '')
        if (t === q || u === q) rank = 3
        else if (t.startsWith(q) || u.startsWith(q)) rank = 2
        else if (t.includes(q) || u.includes(q) || q.split(' ').every((w) => t.includes(w))) rank = 1
        else continue
      }
      chats.push({ id: String(d.id), title, kind, username, rank })
    }
    return chats.sort((a, b) => b.rank - a.rank).map(({ rank: _r, ...c }) => c)
  }

  /**
   * Read a group's recent posts and store the job posts among them: since the
   * last message seen, or the last `days` days for a newly added group.
   * Oldest first, so the inbox keeps the group's order.
   */
  async fetchHistory(chatId: string, opts: { days?: number; sinceLast?: boolean } = {}): Promise<{ found: number; created: number }> {
    if (this.#fetching.has(chatId)) return { found: 0, created: 0 }
    this.#fetching.add(chatId)
    try {
      const dialogs = await this.#dialogs()
      const d = dialogs.find((x) => String(x.id) === String(chatId))
      if (!d) throw new Error('That group isn’t in your Telegram chats any more (left or deleted?).')
      const title = d.title || chatId
      const sync = await readSync(chatId)
      const minId = opts.sinceLast && sync?.last_message_id ? sync.last_message_id : 0
      const days = opts.days ?? settingsStore.load().telegram.history_days ?? 3
      const cutoff = minId ? 0 : Date.now() - days * 86_400_000
      const client = this.client!
      const raw = (await client.getMessages(d.entity ?? d, { limit: MAX_HISTORY, ...(minId ? { minId } : {}) })) as TgMessage[]
      const msgs = raw
        .filter((m) => typeof m.id === 'number' && (!cutoff || (m.date ?? 0) * 1000 >= cutoff))
        .sort((a, b) => a.id! - b.id!)
      let created = 0
      let maxId = sync?.last_message_id ?? 0
      for (const m of msgs) {
        maxId = Math.max(maxId, m.id!)
        const text = messageText(m)
        if (!text.trim() || !this.#ingest) continue
        try {
          created += await this.#ingest(text, title, {
            chatId,
            messageId: m.id!,
            postedAt: m.date ? new Date(m.date * 1000).toISOString() : null,
            live: false,
          })
        } catch (e) {
          log(`skipped message ${m.id} in ${title}:`, errMessage(e))
        }
      }
      // Remember the newest message even when we only looked back N days,
      // so the next catch-up starts from here.
      const newest = raw.reduce((mx, m) => Math.max(mx, typeof m.id === 'number' ? m.id : 0), maxId)
      await writeSync(chatId, { last_message_id: newest, last_fetch_at: new Date().toISOString(), last_fetch_found: msgs.length, last_fetch_new: created, error: null })
      log(`Fetched ${msgs.length} message(s) from ${title}: ${created} new post(s)`)
      return { found: msgs.length, created }
    } catch (e) {
      await writeSync(chatId, { error: errMessage(e), last_fetch_at: new Date().toISOString() }).catch(() => {})
      throw e
    } finally {
      this.#fetching.delete(chatId)
    }
  }

  /** Every watched group: whatever was posted since the last message seen. */
  async catchUp(): Promise<number> {
    if (this.state !== 'connected') return 0
    let created = 0
    for (const c of settingsStore.load().telegram.watched_chats || []) {
      try {
        created += (await this.fetchHistory(String(c.id), { sinceLast: true })).created
      } catch (e) {
        log(`catch-up for ${c.title} failed:`, errMessage(e))
      }
    }
    return created
  }

  /**
   * Disconnect the client but keep the saved session, so pressing Connect again
   * (or a server restart) resumes without a new login code.
   */
  async disconnect(): Promise<TelegramStatus> {
    if (this.client !== null) {
      try {
        await this.client.disconnect()
      } catch {
        /* already gone */
      }
    }
    this.client = null
    this.#handlerRegistered = false
    if (this.#catchUpTimer) clearInterval(this.#catchUpTimer)
    this.#catchUpTimer = null
    this.#loginInFlight = false
    this.#codeDeferred = null
    this.#passwordDeferred = null
    this.#setState('disconnected')
    return this.status()
  }

  /** On server boot, silently reconnect if a valid session exists. */
  async tryAutostart(): Promise<void> {
    const cfg = settingsStore.load().telegram
    if (!cfg.api_id || !cfg.api_hash) return
    if (!readSavedSession()) return
    try {
      const client = await this.#ensureClient()
      if (await client.isUserAuthorized()) {
        this.#onAuthorized()
      } else {
        await client.disconnect()
        this.client = null
      }
    } catch (e) {
      console.warn('[autoapply.telegram] autostart skipped:', errMessage(e))
    }
  }
}

// One manager per process. Next.js can evaluate a module more than once across
// route bundles / hot reloads; the MTProto session must have a single holder.
const GLOBAL_KEY = Symbol.for('autoapply.telegram.manager')
type GlobalWithTg = typeof globalThis & { [GLOBAL_KEY]?: TelegramManager }

const g = globalThis as GlobalWithTg
export const manager: TelegramManager = (g[GLOBAL_KEY] ??= new TelegramManager())
