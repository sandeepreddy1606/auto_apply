import { eventsSince, getSession } from '@/lib/apply/sessions'
import { HttpError, intParam } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Server-sent events: new timeline events for a session as they happen.
 * Polls the events table, so it works no matter which process wrote them
 * (the worker or this server). Auth: the session cookie (or ?token= for API clients),
 * because EventSource can't send headers.
 */
export async function GET(req: Request, ctx: { params: Promise<{ sid: string }> }): Promise<Response> {
  let sid: number
  try {
    sid = intParam((await ctx.params).sid)
  } catch (e) {
    return new Response((e as HttpError).message, { status: 404 })
  }
  if (!(await getSession(sid))) return new Response('Not found', { status: 404 })
  const startAfter = Number(new URL(req.url).searchParams.get('after') || 0)
  const enc = new TextEncoder()
  let last = Number.isFinite(startAfter) ? startAfter : 0
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s))
      }
      send(': connected\n\n')
      const tick = async () => {
        try {
          const evs = await eventsSince(sid, last)
          for (const e of evs) {
            last = e.id
            send(`id: ${e.id}\nevent: session\ndata: ${JSON.stringify(e)}\n\n`)
          }
          if (!evs.length) send(': ping\n\n')
        } catch {
          /* transient DB error; try again next tick */
        }
      }
      timer = setInterval(() => void tick(), 1000)
      void tick()
      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(timer)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })
    },
    cancel() {
      closed = true
      clearInterval(timer)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
