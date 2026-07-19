import { useEffect, useState } from 'react'

/* Tiny hash router: pages are #/foo/bar?x=1 — the browser back button,
   refresh and deep links all work without a server-side router. */

// A page with unsaved edits registers a guard; navigate() consults it so that
// EVERY in-app navigation (bottom nav, links, back buttons) confirms before
// discarding, not just the header back button.
let _guard = null
export function setNavGuard(fn) { _guard = fn }

export function navigate(to, { force = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`
  if (!force && _guard && _guard()) {
    if (!window.confirm('You have unsaved changes. Discard them?')) return
    _guard = null // proceeding — drop the guard so it doesn't re-prompt
  }
  window.location.hash = target
}

export function useRoute() {
  const [raw, setRaw] = useState(() => window.location.hash.slice(1) || '/')
  useEffect(() => {
    const onChange = () => setRaw(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const [path, queryString] = raw.split('?')
  const segments = path.split('/').filter(Boolean)
  const query = Object.fromEntries(new URLSearchParams(queryString || ''))
  return { raw, path: path || '/', segments, query }
}
