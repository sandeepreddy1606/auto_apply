# Deploying Auto Apply (free, always-on, mobile)

Goal: run the app on a free server that **never sleeps** (so company career
pages keep being scanned on schedule), reachable from your phone over HTTPS,
and installable as an app icon on your Android home screen.

Your job data already lives in **Neon Postgres** (cloud). Settings, login
password, uploaded resumes and the browser profile are files kept on a
**persistent disk** on the server.

---

## Why a free VM (not Render/Railway free)

One-click free tiers **spin down when idle** — a sleeping server stops the
scheduled scans and the background worker. A free VM that runs continuously is
the only way to keep them running for $0. Use one of:

- **Oracle Cloud — Always Free** (recommended): a free-forever small ARM VM with
  a persistent disk. Runs 24/7.
- **Google Cloud — `e2-micro` Always Free**: similar, US regions.

The steps below use Oracle; Google Cloud is nearly identical once you have an
Ubuntu VM with a public IP.

---

## 1. Create the free server

1. Sign up at **cloud.oracle.com** → choose **Always Free** eligible resources.
2. Create a **Compute Instance**:
   - Image: **Ubuntu 22.04**.
   - Shape: **VM.Standard.A1.Flex** (Ampere/ARM, Always Free) — 1 OCPU / 6 GB is plenty.
   - Add your SSH key (or let it generate one) so you can log in.
3. Under **Networking**, open ports **80** and **443** (add ingress rules for
   0.0.0.0/0 to TCP 80 and 443 in the VCN security list).
4. Note the instance's **public IP**.

## 2. Point a free domain at it (needed for HTTPS + phone install)

1. Go to **duckdns.org**, sign in, create a subdomain e.g. `yourname.duckdns.org`.
2. Set its IP to your server's public IP.

## 3. Install Docker on the server

SSH in (`ssh ubuntu@<public-ip>`), then:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
```

## 4. Get the code and configure secrets

```bash
git clone -b career_flow https://github.com/sandeepreddy1606/auto_apply.git
cd auto_apply
nano .env
```

Put this in `.env` (this file is gitignored — it holds your secrets):

```
DATABASE_URL=postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require&channel_binding=require
DOMAIN=yourname.duckdns.org
```

## 5. Launch

```bash
docker compose up -d --build
```

That builds the Next.js app, starts it, and starts Caddy which fetches a free
HTTPS certificate for your domain automatically. Give it ~1 minute, then open:

**https://yourname.duckdns.org**

## 6. First-time setup (in the browser, once)

1. Create your **account** (and save the recovery code).
2. **Settings → Job preferences / Profile / Resumes** — fill them in.
3. **Companies** — add the career pages to watch. Scans run on a schedule.
4. On a server there is no screen, so set **Settings → Apply automation** to
   **Headless**. Sites that need you to sign in or solve a CAPTCHA will stop for
   you; finish those from a computer running the app with a visible browser.

## 7. Install it on your Android home screen (PWA)

Open the site in **Chrome on your phone → ⋮ menu → "Add to Home screen"**. It
installs as a full-screen app icon called **Auto Apply**.

---

## Updating later

```bash
cd auto_apply && git switch career_flow && git pull && docker compose up -d --build
```

## Notes

- **Costs:** Oracle Always Free + Neon free tier + DuckDNS = $0/month.
- **Backups:** the persistent volume `aa_data` holds settings, resumes and the browser profile;
  your jobs are in Neon (which has its own backups).
- **Security:** keep `.env` off git (it already is). Your dashboard password
  protects the site; HTTPS protects it in transit.

## Notes on scaling

Run a **single** app replica. The career-page scan loop and the worker start
once per server process (`instrumentation.ts`), and the browser profile can be
open in one browser at a time. Postgres via `DATABASE_URL` is fine to share; the
app process is not.

## Upgrading from the Python build

`docker compose up -d --build` picks up the new image with no compose changes:
the container still listens on 8787 and still persists to the `/data` volume,
and the database schema is unchanged.
