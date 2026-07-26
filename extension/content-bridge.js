// Runs on the Auto Apply app pages (localhost). Reads the login token the app
// stored in localStorage and hands it to the extension, so the form autofill
// can pull your profile without you entering anything twice. Harmless on other
// localhost sites (it only acts when an 'aa_token' is present).
(function () {
  let last = null
  function push() {
    let token = null
    try { token = window.localStorage.getItem('aa_token') } catch (e) { return }
    if (token && token !== last) {
      last = token
      try {
        chrome.runtime.sendMessage({ type: 'aa-set-token', token, base: window.location.origin })
      } catch (e) { /* extension context invalidated — ignore */ }
    }
  }
  push()
  // The app is a single-page app, so the token may appear after login without a
  // reload — re-check periodically.
  setInterval(push, 3000)
})()
