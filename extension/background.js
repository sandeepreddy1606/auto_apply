// Service worker: bridges the app's login token to the extension and fetches
// the profile from the running Auto Apply app. Fetches happen here (not in the
// content script) so host_permissions exempt them from the page's CORS rules.

const DEFAULT_BASE = 'http://127.0.0.1:8787'

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'aa-set-token') {
    chrome.storage.local.set({ aaToken: msg.token, aaBase: msg.base || DEFAULT_BASE })
    sendResponse({ ok: true })
    return false
  }
  if (msg && msg.type === 'aa-get-profile') {
    getProfile().then(sendResponse)
    return true // keep the channel open for the async response
  }
  return false
})

async function getProfile() {
  const st = await chrome.storage.local.get(['aaToken', 'aaBase', 'aaProfileCache'])
  const base = st.aaBase || DEFAULT_BASE
  if (st.aaToken) {
    try {
      const res = await fetch(base + '/api/settings', {
        headers: { Authorization: 'Bearer ' + st.aaToken },
      })
      if (res.ok) {
        const data = await res.json()
        const profile = data.profile || {}
        await chrome.storage.local.set({ aaProfileCache: profile, aaProfileAt: Date.now() })
        return { ok: true, profile, source: 'app' }
      }
      if (res.status === 401) {
        return { ok: !!st.aaProfileCache, profile: st.aaProfileCache || null,
                 error: 'signin', source: 'cache' }
      }
    } catch (e) {
      // App not running / unreachable — fall through to cache.
    }
  }
  if (st.aaProfileCache) return { ok: true, profile: st.aaProfileCache, source: 'cache' }
  return { ok: false, profile: null, error: 'no-token' }
}
