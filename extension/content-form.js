// Runs on Google Form pages. Pulls your profile from the Auto Apply app (via
// the background worker), fills every field it recognises, highlights required
// fields left blank, and lets you submit — all inside your logged-in browser,
// so sign-in / org-restricted forms work.
(function () {
  if (window.__aaFormLoaded) return
  window.__aaFormLoaded = true

  const RULES = window.AA_RULES || []
  let PROFILE = null
  let PSTATE = null
  let SETTINGS = { autofillOnLoad: true, autoSubmit: false, highlight: true }
  let statusEl, submitBtn, fillBtn

  // ---------- helpers ----------
  const q = (root, sel) => root.querySelector(sel)
  const qa = (root, sel) => [].slice.call(root.querySelectorAll(sel))
  const items = () => qa(document, 'div[role=listitem]')

  function pv(key) {
    const full = String(PROFILE.full_name || '').trim()
    if (key === 'first_name') return full.split(/\s+/)[0] || ''
    if (key === 'last_name') { const a = full.split(/\s+/); return a.length > 1 ? a[a.length - 1] : '' }
    return PROFILE[key] || ''
  }

  function mapTitle(t) {
    t = (t || '').toLowerCase()
    for (let i = 0; i < RULES.length; i++) {
      try { if (new RegExp(RULES[i][0]).test(t)) return RULES[i][1] } catch (e) { /* skip */ }
    }
    return null
  }

  function setVal(el, v) {
    try {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } catch (e) { /* ignore */ }
  }

  function clickMatch(els, v) {
    v = String(v || '').trim().toLowerCase()
    if (!v) return false
    const a = [].slice.call(els)
    const label = (el) => String(el.getAttribute('aria-label') || el.innerText || '').trim().toLowerCase()
    for (const el of a) if (label(el) === v) { el.click(); return true }
    for (const el of a) { const l = label(el); if (l && (l.indexOf(v) >= 0 || v.indexOf(l) >= 0)) { el.click(); return true } }
    return false
  }

  const heading = (item) => q(item, 'div[role=heading]')
  const textInput = (item) => q(item, 'input[type=text],input[type=email],input[type=url],input[type=tel],input:not([type])')

  function isRequired(item) {
    if (q(item, '[aria-required="true"]')) return true
    if (q(item, '[aria-label*="Required" i]')) return true
    const h = heading(item)
    if (h && /\*\s*$/.test((h.innerText || '').trim())) return true
    return false
  }

  function isAnswered(item) {
    const inp = q(item, 'input[type=text],input[type=email],input[type=url],input[type=tel],input:not([type]),textarea')
    if (inp) return !!String(inp.value || '').trim()
    if (q(item, '[role=radio][aria-checked="true"],[role=checkbox][aria-checked="true"],[role=option][aria-selected="true"]')) return true
    return false
  }

  function fillItem(item, onlyEmpty) {
    const h = heading(item)
    if (!h) return false
    const key = mapTitle(h.innerText)
    if (!key) return false
    const v = pv(key)
    if (!v) return false
    if (q(item, 'input[type=file]')) return false // file uploads can't be scripted (browser security)

    const inp = textInput(item)
    if (inp) { if (onlyEmpty && inp.value) return false; setVal(inp, v); return true }
    const ta = q(item, 'textarea')
    if (ta) { if (onlyEmpty && ta.value) return false; setVal(ta, v); return true }
    const radios = qa(item, '[role=radio]')
    if (radios.length) {
      if (onlyEmpty && q(item, '[role=radio][aria-checked="true"]')) return false
      return clickMatch(radios, v)
    }
    const checks = qa(item, '[role=checkbox]')
    if (checks.length) {
      let did = false
      String(v).split(/[,/;]/).forEach((p) => { if (clickMatch(checks, p.trim())) did = true })
      return did
    }
    const listbox = q(item, '[role=listbox]')
    if (listbox) {
      listbox.click()
      setTimeout(() => clickMatch(qa(document, '[role=option]'), v), 320)
      return true
    }
    return false
  }

  function requiredMissing() {
    return items().filter((it) => isRequired(it) && !isAnswered(it)).length
  }

  function markMissing() {
    items().forEach((it) => {
      it.classList.toggle('aa-missing', SETTINGS.highlight && isRequired(it) && !isAnswered(it))
    })
  }

  function findSubmit() {
    const btns = qa(document, '[role=button]')
    for (const b of btns) {
      const t = String(b.innerText || '').trim().toLowerCase()
      if (t === 'submit' || t === 'send') return b
    }
    return null
  }

  function runFill(onlyEmpty) {
    let filled = 0
    // "Collect email" field sits outside the normal question list.
    if (PROFILE.email) {
      const em = q(document, 'input[type=email]')
      if (em && (!onlyEmpty || !em.value)) { setVal(em, PROFILE.email); filled++ }
    }
    items().forEach((it) => { if (fillItem(it, onlyEmpty)) filled++ })
    markMissing()
    return { filled, missing: requiredMissing(), total: items().length }
  }

  // ---------- UI ----------
  function injectPanel() {
    if (document.getElementById('aa-panel')) return
    const panel = document.createElement('div')
    panel.id = 'aa-panel'
    panel.innerHTML =
      '<div class="aa-h"><span>⚡ Auto Apply</span><button id="aa-close" title="Hide">×</button></div>' +
      '<div id="aa-status">Loading your profile…</div>' +
      '<div class="aa-btns"><button id="aa-fill">Autofill</button>' +
      '<button id="aa-submit" hidden>Submit ✓</button></div>' +
      '<button id="aa-sync" class="aa-link">↻ Reload profile</button>'
    document.body.appendChild(panel)
    fillBtn = document.getElementById('aa-fill')
    submitBtn = document.getElementById('aa-submit')
    statusEl = document.getElementById('aa-status')
    fillBtn.onclick = () => doFill(false)
    submitBtn.onclick = () => { const s = findSubmit(); if (s) s.click(); else setStatus('Couldn’t find the Submit button — scroll down and submit manually.') }
    document.getElementById('aa-close').onclick = () => { panel.style.display = 'none' }
    document.getElementById('aa-sync').onclick = () => {
      setStatus('Reloading…'); loadProfile().then(() => updateProfileStatus(true))
    }
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg }

  function updateProfileStatus(afterSync) {
    if (PROFILE && (PROFILE.full_name || PROFILE.email)) {
      setStatus('Profile: ' + (PROFILE.full_name || PROFILE.email) + (afterSync ? ' (reloaded)' : '') + '. Click Autofill.')
      fillBtn.disabled = false
    } else if (PSTATE && PSTATE.error === 'signin') {
      setStatus('Session expired — open Auto Apply, sign in, then ↻.')
      fillBtn.disabled = true
    } else {
      setStatus('Open Auto Apply (127.0.0.1:8787), sign in, then click ↻.')
      fillBtn.disabled = true
    }
  }

  function doFill(onlyEmpty) {
    if (!PROFILE) { updateProfileStatus(); return }
    const r = runFill(onlyEmpty)
    let msg = 'Filled ' + r.filled + ' field' + (r.filled === 1 ? '' : 's') + '. '
    msg += r.missing > 0
      ? r.missing + ' required still need you (highlighted).'
      : 'Everything required is filled ✓'
    setStatus(msg)
    submitBtn.hidden = false
    submitBtn.classList.toggle('ready', r.missing === 0)
    if (SETTINGS.autoSubmit && r.missing === 0) {
      const s = findSubmit(); if (s) { setStatus('All filled — submitting…'); s.click() }
    }
  }

  // ---------- profile / settings ----------
  function loadSettings() {
    return new Promise((res) => {
      try {
        chrome.storage.local.get(['aaSettings'], (d) => {
          if (d && d.aaSettings) SETTINGS = Object.assign(SETTINGS, d.aaSettings)
          res()
        })
      } catch (e) { res() }
    })
  }

  function loadProfile() {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage({ type: 'aa-get-profile' }, (r) => {
          PSTATE = r || null
          PROFILE = (r && r.profile) || null
          res(r)
        })
      } catch (e) { res(null) }
    })
  }

  // ---------- lifecycle ----------
  function waitForQuestions(cb) {
    let n = 0
    const iv = setInterval(() => {
      if (items().length > 0 || n++ > 75) { clearInterval(iv); cb() }
    }, 200)
  }

  // Re-fill when the visible questions change (multi-page forms: Next/Back).
  let lastSig = ''
  function signature() {
    return items().map((it) => { const h = heading(it); return h ? h.innerText.slice(0, 24) : '' }).join('|')
  }
  function observePages() {
    lastSig = signature()
    let t
    const mo = new MutationObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        const s = signature()
        if (s && s !== lastSig) {
          lastSig = s
          if (SETTINGS.autofillOnLoad && PROFILE) doFill(true)
          else markMissing()
        }
      }, 500)
    })
    mo.observe(document.body, { childList: true, subtree: true })
  }

  loadSettings()
    .then(loadProfile)
    .then(() => waitForQuestions(() => {
      injectPanel()
      updateProfileStatus()
      observePages()
      if (SETTINGS.autofillOnLoad && PROFILE) doFill(true)
    }))
})()
