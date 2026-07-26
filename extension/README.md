# Auto Apply — Google Forms Autofill (browser extension)

Fills Google Forms from your Auto Apply profile — including **sign-in / org-restricted
forms**, because it runs inside your own logged-in browser (not on the server, which
Google would turn away).

## Why this works where the app can't

- It runs as a **content script inside the form page**, so it's *same-origin* with the
  form and can read/write the fields directly.
- It runs in **your browser session**, so you're already past Google's sign-in.
- It fills the real fields and clicks the real Submit button — no API needed.

## Install (one time, ~30 seconds)

1. Open **`chrome://extensions`** (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this **`extension`** folder.
4. Done — you'll see "Auto Apply — Google Forms Autofill" in the list. Pin it if you like.

## Use it

1. Keep the **Auto Apply app open and signed in** (http://127.0.0.1:8787) at least once so
   the extension can pull your profile. It caches it, so the app doesn't need to stay open forever.
2. Open any **Google Form** (from the job's *Open the form ↗* button, or anywhere).
3. A **⚡ Auto Apply** panel appears bottom-right. It auto-fills on load; or click **Autofill**.
4. Fields it recognises are filled; required fields it can't fill are **highlighted**. Complete
   those, then click **Submit ✓** (or the form's own submit).

## Options (extension popup)

- **Autofill forms when they open** — fill automatically on page load (default on).
- **Highlight required fields left blank** — yellow outline on what still needs you (default on).
- **Auto-submit when everything is filled** — submit automatically if nothing required is blank
  (default **off** — turn on only once you trust it).

## Notes & limits

- **Resume file-upload questions can't be auto-filled** — browsers forbid scripts from setting a
  file input (security). Those you upload manually. Resume *link* questions are filled from your
  profile's Resume link.
- Multi-page forms: it re-fills each page as you move through.
- Everything stays local: your profile is fetched from your own app and cached in the browser;
  nothing is sent anywhere else.
