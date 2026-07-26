const DEFAULTS = { autofillOnLoad: true, highlight: true, autoSubmit: false }

function setStatus(text, cls) {
  const el = document.getElementById('status')
  el.textContent = text
  el.className = 'status' + (cls ? ' ' + cls : '')
}

function loadSettings() {
  chrome.storage.local.get(['aaSettings'], (d) => {
    const s = Object.assign({}, DEFAULTS, d.aaSettings || {})
    document.getElementById('autofill').checked = s.autofillOnLoad
    document.getElementById('highlight').checked = s.highlight
    document.getElementById('autosubmit').checked = s.autoSubmit
  })
}

function saveSettings() {
  const s = {
    autofillOnLoad: document.getElementById('autofill').checked,
    highlight: document.getElementById('highlight').checked,
    autoSubmit: document.getElementById('autosubmit').checked,
  }
  chrome.storage.local.set({ aaSettings: s })
}

function refreshStatus() {
  setStatus('Checking…')
  chrome.runtime.sendMessage({ type: 'aa-get-profile' }, (r) => {
    if (chrome.runtime.lastError) { setStatus('Extension error — reload it.', 'warn'); return }
    if (r && r.ok && r.profile && (r.profile.full_name || r.profile.email)) {
      const who = r.profile.full_name || r.profile.email
      const src = r.source === 'app' ? 'live from app' : 'cached'
      setStatus('Ready — ' + who + ' (' + src + ').', 'ok')
    } else if (r && r.error === 'signin') {
      setStatus('Session expired. Open Auto Apply and sign in, then reload.', 'warn')
    } else {
      setStatus('No profile yet. Open Auto Apply (127.0.0.1:8787), sign in, then reload.', 'warn')
    }
  })
}

document.getElementById('sync').addEventListener('click', refreshStatus)
;['autofill', 'highlight', 'autosubmit'].forEach((id) =>
  document.getElementById(id).addEventListener('change', saveSettings))

loadSettings()
refreshStatus()
