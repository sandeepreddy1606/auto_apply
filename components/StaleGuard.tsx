'use client'

/**
 * Keeps an open tab working across app updates.
 *
 *  - A page chunk that no longer exists (the app was rebuilt or restarted on a
 *    new version) makes clicks silently do nothing. Reload once, automatically.
 *  - The server reports its build; when it changes under an open tab, offer a
 *    reload instead of letting pages half-load.
 */
import { useEffect, useRef, useState } from 'react'

const RELOADED = 'aa-chunk-reload'

function isChunkError(msg: string): boolean {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}

export default function StaleGuard() {
  const first = useRef<string | null>(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const recover = (msg: string) => {
      if (!isChunkError(msg)) return
      let done = false
      try {
        done = sessionStorage.getItem(RELOADED) === '1'
        sessionStorage.setItem(RELOADED, '1')
      } catch {
        /* storage blocked: reload anyway, once per page */
      }
      if (!done) window.location.reload()
      else setStale(true)
    }
    const onError = (e: ErrorEvent) => recover(String(e.message || e.error?.message || ''))
    const onRejection = (e: PromiseRejectionEvent) => recover(String((e.reason as Error)?.message ?? e.reason ?? ''))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    // A clean load clears the one-time flag after a moment.
    const clear = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOADED)
      } catch {
        /* ignore */
      }
    }, 10_000)

    const check = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' })
        const { build } = (await r.json()) as { build?: string }
        if (!build) return
        if (first.current === null) first.current = build
        else if (build !== first.current) setStale(true)
      } catch {
        /* server restarting */
      }
    }
    void check()
    const t = setInterval(check, 60_000)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('focus', onFocus)
      clearInterval(t)
      clearTimeout(clear)
    }
  }, [])

  if (!stale) return null
  return (
    <div className="stale-bar" role="status">
      <span>Auto Apply was updated. Reload to use the new version.</span>
      <button className="btn sm primary" onClick={() => window.location.reload()}>Reload</button>
    </div>
  )
}
