/**
 * Shared helpers for the API route handlers: FastAPI-compatible JSON error
 * shapes, body parsing, and field whitelisting.
 *
 * The client (and the browser extension) read `{ "detail": "..." }` on failure,
 * exactly as FastAPI emitted — keep that shape.
 */
import { NextResponse } from 'next/server'

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export const json = <T>(data: T, status = 200): NextResponse =>
  NextResponse.json(data, { status })

export const detail = (message: string, status: number): NextResponse =>
  NextResponse.json({ detail: message }, { status })

/**
 * Wrap a handler so thrown errors become the JSON error shape instead of an
 * opaque 500 page.
 */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (e instanceof HttpError) return detail(e.message, e.status)
      console.error('[autoapply.api] unhandled error:', e)
      const message = e instanceof Error ? e.message : 'Internal server error'
      return detail(message, 500)
    }
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text()
    if (!text.trim()) return {} as T
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}

/**
 * Copy only the listed keys, dropping null/undefined — the equivalent of
 * FastAPI's Pydantic model plus `if v is not None`.
 *
 * This is also a security boundary: updateApplication interpolates its keys
 * straight into `SET <col> = ?`, so keys must never come from raw user input.
 */
export function pick<T extends Record<string, unknown>>(
  body: Record<string, unknown>,
  allowed: readonly string[],
): T {
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    const v = body[key]
    if (v !== null && v !== undefined) out[key] = v
  }
  return out as T
}

/** Parse a positive integer route param, or throw a 404 like the original did. */
export function intParam(value: string, what = 'id'): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, `Invalid ${what}.`)
  return n
}

export const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
