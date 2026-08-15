# ZenScriptsAI — Setup & Deployment Guide

This guide covers the full backend: **AI script generation**, **Premium payments**
(Stripe Checkout + redeem codes) and **user accounts**. The landing page is
`files/index.html`; all backend logic lives in `lib/` and runs on any of the three
hosts below.

## Quick start (local)

```bash
cp .env.example .env        # set LLM_API_KEY=sk-...
node server.js              # → http://localhost:3000
```

## Environment variables

| Variable        | Default                 | Description                                        |
|-----------------|-------------------------|----------------------------------------------------|
| `LLM_API_KEY`   | *(fallback: OPENAI_API_KEY)* | API key for an OpenAI-compatible provider    |
| `LLM_BASE_URL`  | `https://api.openai.com/v1` | OpenAI, OpenRouter, Groq, DeepSeek, ...       |
| `LLM_MODEL`     | `gemini-2.0-flash`           | Model name                                          |
| `PORT`          | `3000`                  | Server port (Render sets this automatically)        |
| `STRIPE_SECRET_KEY` | —                  | Stripe API key — enables real checkout (`/api/pay`) |
| `STRIPE_PRICE_ID`   | —                  | Recurring price ID from the Stripe dashboard        |
| `SITE_URL`      | `http://localhost:3000` | Your site URL (Checkout success redirect)           |
| `PREMIUM_CODES` | —                      | Comma-separated redeem codes, e.g. `TEST-ABC,LAUNCH-2024` |
| `DATA_DIR`      | `./data`               | Where account data (users/sessions) is written      |

The LLM/Stripe keys live **only on the server/function** — never sent to the browser.

## Endpoints

| Endpoint         | Body `{ action, ... }`                            |
|------------------|---------------------------------------------------|
| `POST /api/generate` | generation payload (game, platform, mods, ...) |
| `POST /api/pay`  | `create-checkout` · `confirm` · `redeem`          |
| `POST /api/auth` | `register` · `login` · `me` · `logout`            |

---

# Deployment

## 🟢 Render (easiest — full Node server)

1. Push to GitHub → Render → **New → Web Service** → connect the repo.
2. Runtime: Node · Build command: *(empty)* · Start command: `node server.js` · Health check: `/`.
3. Add env vars (`LLM_API_KEY`, plus Stripe/PREMIUM_CODES as needed).
4. Deploy. One-click alternative: **New → Blueprint** (`render.yaml` is included).

Free plan auto-sleeps after 15 min idle; the page's 60s timeout covers the wake-up.

⚠️ **Accounts on the free plan:** Render free instances use an **ephemeral disk** —
user accounts (under `DATA_DIR`, default `./data/`) are wiped whenever the service
restarts or redeploys. For durable accounts: use a paid instance with a **Disk**
attached, or swap `loadStore`/`saveStore` in `lib/auth.js` for a hosted database
(Supabase, Turso, …). The rest of the app works fine on free.

## 🔵 Vercel (static page + serverless functions)

`vercel.json` rewrites `/` → the page; `api/{generate,pay,auth}.js` become
`/api/{generate,pay,auth}` automatically.

1. Push to GitHub → Vercel → **Add New → Project** → import.
2. Framework Preset: `Other` · Build: empty.
3. Add env vars, deploy.

⚠️ Serverless filesystems are ephemeral — see the accounts note below.

## ⚫ Netlify (static page + functions)

`netlify.toml` publishes `files/` and redirects `/api/{generate,pay,auth}` to
`netlify/functions/`. Import the repo, add env vars, deploy (`.nvmrc` pins Node 20).

---

# Premium payments (Stripe Checkout)

**Flow:** Upgrade button → `POST /api/pay {action:"create-checkout"}` → Stripe hosted
subscription checkout ($9.99/mo) → user returns with `?premium=success&session_id=…`
→ page verifies via `{action:"confirm"}` → premium mods unlock (localStorage + account
if logged in).

**Setup:**
1. Stripe Dashboard → **Products** → create a recurring $9.99/mo price → copy `price_…`.
2. Set `STRIPE_SECRET_KEY` (`sk_test_…` to test), `STRIPE_PRICE_ID`, `SITE_URL`.
3. Test card: **4242 4242 4242 4242**.
4. No keys? The Upgrade modal shows a friendly "payments not configured" error.

**Redeem codes (no Stripe):** `PREMIUM_CODES=CODE1,CODE2` — users enter a code in the
Upgrade modal. **Payment link:** set `PREMIUM.link` in the page JS to a Stripe Payment
Link and the buttons open it directly.

> Production: add a `checkout.session.completed` webhook for durable subscription state.

# Accounts & login

Nav **Log In** → tabbed modal (Log In / Create Account). Passwords hashed with
**scrypt** + salt; sessions are 48-hex tokens. **Premium is account-based** — redeem or
pay while logged in marks the account (`accountPremium: true`), restored on any later
login.

Storage: JSON store under `DATA_DIR` (`data/users-<ts>.json`, newest wins — checkpoint
pattern). Works locally and on hosts with a writable disk (Render + attached disk).
On Vercel/Netlify the filesystem resets on cold start — swap `loadStore`/`saveStore`
in `lib/auth.js` for a hosted DB (Supabase, Turso, …) for durable serverless accounts.

# Layout

```
files/index.html                        ← the page
lib/generate.js · lib/pay.js · lib/auth.js ← shared logic (all hosts)
server.js                               ← local / Render entrypoint
api/{generate,pay,auth}.js              ← Vercel functions
netlify/functions/{generate,pay,auth}.js ← Netlify functions
vercel.json · netlify.toml · render.yaml · .nvmrc · .env.example
```
