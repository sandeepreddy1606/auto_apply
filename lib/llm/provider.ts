/**
 * One entry point for every AI call: `generateJson`.
 *
 * Providers (Settings → AI):
 *   claude-code — runs your local Claude Code CLI, signed in with your Claude
 *                 Pro account: `claude -p --output-format json --json-schema …
 *                 --tools "" --no-session-persistence`. Tools are disabled, so
 *                 the call is pure text in / JSON out and can't touch files.
 *   manual      — the app shows the prompt; you paste the answer from claude.ai.
 *
 * Every call is logged in `llm_calls`; identical inputs are served from that
 * log (cache); a daily cap protects your Pro limits; on failure the call can
 * fall back to manual so you're never blocked.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseJson, sql } from '@/lib/server/db'
import * as settingsStore from '@/lib/server/settings'
import { findTool, runTool } from '@/lib/setup/tools'
import type { AiConfig } from '@/lib/types'

export interface LlmRequest {
  purpose: string
  system: string
  prompt: string
  schema: object
}

export type LlmResult<T> =
  | { kind: 'data'; data: T; callId: number; cached: boolean }
  | { kind: 'manual'; callId: number; reason: string }

export class LlmError extends Error {
  code: 'not_installed' | 'not_logged_in' | 'limit' | 'cap' | 'timeout' | 'invalid' | 'failed'

  constructor(code: LlmError['code'], message: string) {
    super(message)
    this.name = 'LlmError'
    this.code = code
  }
}

export const inputHash = (r: LlmRequest): string =>
  crypto.createHash('sha256').update(`${r.purpose}\n${r.system}\n${r.prompt}\n${JSON.stringify(r.schema)}`).digest('hex')

/** Find the claude binary: Settings override, then PATH / ~/.local/bin. */
export function claudePath(ai: AiConfig): string | null {
  if (ai.claude_path && fs.existsSync(ai.claude_path)) return ai.claude_path
  return findTool('claude')
}

/** Pull the structured result out of `claude -p --output-format json` stdout. */
export function parseClaudeOutput(stdout: string): { data: unknown; isError: boolean; message: string } {
  const text = stdout.trim()
  const start = text.indexOf('{')
  let obj: Record<string, unknown> | null = null
  try {
    obj = JSON.parse(start >= 0 ? text.slice(start) : text) as Record<string, unknown>
  } catch {
    // Some versions print one JSON object per line; take the result line.
    for (const line of text.split('\n').reverse()) {
      try {
        const o = JSON.parse(line) as Record<string, unknown>
        if (o.type === 'result') {
          obj = o
          break
        }
      } catch {
        /* next */
      }
    }
  }
  if (!obj) return { data: null, isError: true, message: text.slice(0, 300) || 'No output from claude' }
  const message = typeof obj.result === 'string' ? obj.result : ''
  if (obj.is_error === true || obj.subtype === 'error') return { data: null, isError: true, message }
  if (obj.structured_output !== undefined) return { data: obj.structured_output, isError: false, message }
  // Fallback: the JSON may be in the result text, possibly fenced.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(message)
  const candidate = fenced ? fenced[1] : message.slice(message.indexOf('{'))
  try {
    return { data: JSON.parse(candidate), isError: false, message }
  } catch {
    return { data: null, isError: true, message: message.slice(0, 300) || 'Output was not JSON' }
  }
}

function classify(message: string): LlmError['code'] {
  const m = message.toLowerCase()
  if (/usage limit|rate limit|limit reached|quota|too many requests|429/.test(m)) return 'limit'
  if (/log ?in|logged in|authenticat|unauthori[sz]ed|invalid api key|oauth|\/login/.test(m)) return 'not_logged_in'
  return 'failed'
}

/**
 * Environment for the `claude` CLI with every pay-per-use route removed, so it
 * can only run on your Claude subscription login (never billed per token):
 * an API key, a custom auth token/gateway, or Bedrock/Vertex/Foundry cloud
 * billing would each make the CLI charge that account instead.
 */
export const PAID_ENV_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_VERTEX_PROJECT_ID', 'ANTHROPIC_FOUNDRY_API_KEY',
]

export function subscriptionOnlyEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const k of PAID_ENV_VARS) delete env[k]
  return env
}

export async function runClaudeCode(
  req: LlmRequest,
  ai: AiConfig,
): Promise<unknown> {
  const bin = claudePath(ai)
  if (!bin) throw new LlmError('not_installed', 'Claude Code CLI not found. Install it, run `claude` once to sign in, then Recheck.')
  // An empty working dir: no CLAUDE.md or project settings get picked up.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-llm-'))
  try {
    const args = [
      '-p',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(req.schema),
      '--tools', '',
      '--system-prompt', req.system,
      '--no-session-persistence',
      ...(ai.model ? ['--model', ai.model] : []),
    ]
    const r = await runTool(bin, args, { cwd, input: req.prompt, timeoutMs: ai.timeout_s * 1000, env: subscriptionOnlyEnv() })
    if (r.timedOut) throw new LlmError('timeout', `Claude didn't answer within ${ai.timeout_s}s.`)
    const out = parseClaudeOutput(r.stdout || r.stderr)
    if (out.isError || r.code !== 0) {
      const msg = out.message || r.stderr.slice(0, 300) || `claude exited with code ${r.code}`
      throw new LlmError(classify(msg), msg)
    }
    return out.data
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

async function callsToday(): Promise<number> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const r = await sql.one(
    "SELECT COUNT(*) AS n FROM llm_calls WHERE provider = 'claude-code' AND at >= ? AND status != 'cached'",
    [since.toISOString()],
  )
  return Number(r?.n ?? 0)
}

async function logCall(fields: {
  provider: string
  purpose: string
  hash: string
  req?: LlmRequest
  output?: unknown
  status: 'done' | 'failed' | 'pending' | 'cached'
  ok: boolean
  ms?: number
  error?: string | null
}): Promise<number> {
  return sql.insert(
    'INSERT INTO llm_calls (provider, purpose, input_hash, prompt, system_prompt, schema, output, status, ok, duration_ms, error, at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      fields.provider,
      fields.purpose,
      fields.hash,
      fields.req?.prompt ?? null,
      fields.req?.system ?? null,
      fields.req ? JSON.stringify(fields.req.schema) : null,
      fields.output === undefined ? null : JSON.stringify(fields.output),
      fields.status,
      fields.ok ? 1 : 0,
      fields.ms ?? null,
      fields.error ?? null,
      new Date().toISOString(),
    ],
  )
}

/**
 * Run a JSON-producing AI call. `validate` must throw on bad output; it runs on
 * provider output and on pasted manual answers alike.
 */
export async function generateJson<T>(
  req: LlmRequest,
  validate: (raw: unknown) => T,
  opts: { allowCache?: boolean; ai?: AiConfig } = {},
): Promise<LlmResult<T>> {
  const ai = opts.ai ?? settingsStore.load().ai
  const hash = inputHash(req)

  if (opts.allowCache !== false) {
    const hit = await sql.one(
      "SELECT id, output FROM llm_calls WHERE input_hash = ? AND ok = 1 AND status IN ('done', 'cached') ORDER BY id DESC LIMIT 1",
      [hash],
    )
    if (hit) {
      try {
        const data = validate(parseJson(hit.output))
        return { kind: 'data', data, callId: Number(hit.id), cached: true }
      } catch {
        /* stale cache entry; call again */
      }
    }
  }

  const toManual = async (reason: string): Promise<LlmResult<T>> => {
    const callId = await logCall({ provider: 'manual', purpose: req.purpose, hash, req, status: 'pending', ok: false, error: reason })
    return { kind: 'manual', callId, reason }
  }

  if (ai.provider === 'manual') return toManual('Manual mode is selected in Settings → AI.')
  if (ai.provider === 'anthropic-api') {
    return toManual('The API-key provider isn’t available in this build; using manual mode.')
  }

  if ((await callsToday()) >= ai.daily_cap) {
    if (ai.fallback_manual) return toManual(`Daily AI cap (${ai.daily_cap}) reached.`)
    throw new LlmError('cap', `Daily AI cap (${ai.daily_cap}) reached — raise it in Settings → AI.`)
  }

  const started = Date.now()
  let lastErr: LlmError | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = attempt === 0 || !lastErr ? req.prompt : `${req.prompt}\n\nYour previous answer was rejected: ${lastErr.message}\nReturn corrected JSON only.`
      const raw = await runClaudeCode({ ...req, prompt }, ai)
      const data = validate(raw)
      const callId = await logCall({ provider: 'claude-code', purpose: req.purpose, hash, req, output: raw, status: 'done', ok: true, ms: Date.now() - started })
      return { kind: 'data', data, callId, cached: false }
    } catch (e) {
      lastErr = e instanceof LlmError ? e : new LlmError('invalid', (e as Error).message)
      // Only invalid output is worth retrying with feedback.
      if (lastErr.code !== 'invalid') break
    }
  }
  await logCall({ provider: 'claude-code', purpose: req.purpose, hash, req, status: 'failed', ok: false, ms: Date.now() - started, error: lastErr?.message ?? 'failed' })
  if (ai.fallback_manual && lastErr && lastErr.code !== 'invalid') {
    return toManual(`Claude Code: ${lastErr.message}`)
  }
  throw lastErr ?? new LlmError('failed', 'AI call failed')
}

/** A pasted manual answer: validate, then record it so the pipeline can continue. */
export async function submitManualAnswer<T>(
  callId: number,
  pasted: string,
  validate: (raw: unknown) => T,
): Promise<T> {
  const row = await sql.one('SELECT * FROM llm_calls WHERE id = ?', [callId])
  if (!row) throw new LlmError('failed', 'That AI request no longer exists.')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(pasted)
  const body = (fenced ? fenced[1] : pasted).trim()
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(body.indexOf('{')))
  } catch {
    throw new LlmError('invalid', 'That isn’t valid JSON. Paste the whole JSON answer.')
  }
  const data = validate(raw)
  await sql.run("UPDATE llm_calls SET output = ?, status = 'done', ok = 1, error = NULL WHERE id = ?", [JSON.stringify(raw), callId])
  return data
}

export async function getCall(callId: number): Promise<{
  id: number
  purpose: string
  status: string
  prompt: string | null
  system_prompt: string | null
  schema: unknown
  error: string | null
} | null> {
  const r = await sql.one('SELECT id, purpose, status, prompt, system_prompt, schema, error FROM llm_calls WHERE id = ?', [callId])
  if (!r) return null
  return {
    id: Number(r.id),
    purpose: String(r.purpose),
    status: String(r.status),
    prompt: (r.prompt as string) ?? null,
    system_prompt: (r.system_prompt as string) ?? null,
    schema: parseJson(r.schema),
    error: (r.error as string) ?? null,
  }
}

/** For Settings → AI: installed? signed in? (a tiny real call) */
export async function providerStatus(test = false): Promise<{ provider: string; ok: boolean; detail: string; version: string | null; calls_today: number }> {
  const ai = settingsStore.load().ai
  const calls = await callsToday().catch(() => 0)
  if (ai.provider === 'manual') return { provider: 'manual', ok: true, detail: 'Manual copy/paste mode', version: null, calls_today: calls }
  const bin = claudePath(ai)
  if (!bin) return { provider: ai.provider, ok: false, detail: 'Claude Code CLI not found', version: null, calls_today: calls }
  const v = await runTool(bin, ['--version'], { timeoutMs: 20_000 })
  const version = (v.stdout || '').trim().split('\n')[0] || null
  if (!test) return { provider: ai.provider, ok: true, detail: `Installed${version ? ` (${version})` : ''} — run Test to confirm sign-in`, version, calls_today: calls }
  try {
    const data = await runClaudeCode(
      {
        purpose: 'test',
        system: 'Reply only with data matching the schema.',
        prompt: 'Return {"ok": true}.',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      },
      ai,
    )
    const ok = (data as { ok?: boolean })?.ok === true
    return { provider: ai.provider, ok, detail: ok ? 'Signed in and answering ✓' : 'Unexpected answer from Claude', version, calls_today: calls }
  } catch (e) {
    const err = e as LlmError
    const hint = err.code === 'not_logged_in' ? ' — open a terminal, run `claude`, then /login with your Pro account.' : ''
    return { provider: ai.provider, ok: false, detail: `${err.message}${hint}`, version, calls_today: calls }
  }
}
