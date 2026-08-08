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

import type { TelegramStatus, WatchedChat } from '@/lib/types'

import { TELEGRAM_SESSION_PATH } from './paths'
import * as settingsStore from './settings'

const log = (...args: unknown[]) => console.log('[autoapply.telegram]', ...args)

type IngestFn = (text: string, channel: string) => Promise<void>

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
            message?: { message?: string }
            getChat?: () => Promise<unknown>
          }
          const chatId = ev.chatId ? String(ev.chatId) : ''
          if (!watchedIds.has(chatId)) return

          const text = ev.message?.message || ''
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
          if (this.#ingest) await this.#ingest(text, title)
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

  async listChats(): Promise<WatchedChat[]> {
    const client = await this.#ensureClient()
    if (!(await client.isUserAuthorized())) {
      throw new Error('Telegram is not connected yet.')
    }
    const dialogs = (await client.getDialogs({ limit: 300 })) as {
      isChannel?: boolean
      isGroup?: boolean
      title?: string
      id?: { toString(): string }
    }[]
    const chats: WatchedChat[] = []
    for (const d of dialogs) {
      if ((d.isChannel || d.isGroup) && d.id != null) {
        chats.push({ id: String(d.id), title: d.title || String(d.id) })
      }
    }
    return chats
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
