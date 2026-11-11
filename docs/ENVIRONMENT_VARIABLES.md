# SidCrawal — Environment Variables Reference

Copy [`.env.example`](../.env.example) to `.env.local` for local development. **Never commit `.env.local` or real credentials to Git.**

> [!CAUTION]
> Only variables prefixed with `NEXT_PUBLIC_` are exposed to browser bundles. Keep `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `BROWSER_WORKER_SECRET`, `CLOUDFLARE_DISPATCH_SECRET`, `GITHUB_DISPATCH_TOKEN`, and `UPSTASH_REDIS_REST_TOKEN` strictly server-side.

---

## 1. Application & Deployment Origin

| Variable | Scope | Required | Example / Format | How to Obtain / Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Client + Server | Yes | `https://sidcrawal.vercel.app` | Local: `http://localhost:3000`. Production: canonical HTTPS origin on Vercel; used in auth callbacks, Resend links, and Cloudflare dispatch. |

---

## 2. Supabase (Database, Auth & Storage)

| Variable | Scope | Required | Example / Format | How to Obtain / Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Yes | `https://xyz.supabase.co` | Supabase Dashboard -> **Project Settings -> API -> Project URL**. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Yes | `eyJ...` | Supabase Dashboard -> **Project Settings -> API -> anon/public key**. Safe under RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server + Worker only | Yes | `eyJ...` | Supabase Dashboard -> **Project Settings -> API -> service_role**. Required for crawl persistence, private storage uploads, and `/api/admin/*`. |

---

## 3. Isolated Playwright Browser Worker

| Variable | Scope | Required | Example / Format | How to Obtain / Notes |
| --- | --- | --- | --- | --- |
| `BROWSER_WORKER_URL` | Next.js Server | Yes | `https://worker.sidcrawal.app` | Base URL of your deployed `worker/` service (`http://localhost:4001` locally). |
| `BROWSER_WORKER_SECRET` | Next.js + Worker | Yes | 64-char hex string | Generate with `openssl rand -hex 32`. Validated with constant-time HMAC comparison on `POST /render` and `POST /crawl`. |
| `WORKER_MAX_CONCURRENCY` | Worker only | Optional (`2`) | Integer `1`–`8` | Limits concurrent Chromium launches inside a single worker container. |
| `CRAWL_CONCURRENCY` | Batch Worker only | Optional (`2`) | Integer `1`–`4` | Controls parallel crawl jobs processed per GitHub Actions / CLI batch slice. |

---

## 4. Cloudflare Cron & GitHub Actions Dispatch

| Variable | Scope | Required | Example / Format | How to Obtain / Notes |
| --- | --- | --- | --- | --- |
| `CLOUDFLARE_DISPATCH_SECRET` | Next.js + Cloudflare + Actions | Yes | 64-char hex string | Generate with `openssl rand -hex 32`. Protects `POST /api/internal/dispatch-due` and `POST /api/internal/crawl-results`. |
| `GITHUB_DISPATCH_TOKEN` | Next.js Server | Optional (dispatch mode) | Fine-grained GitHub PAT | Needed if `dispatch-due` triggers `crawler-worker.yml` via GitHub REST API (**Actions: Read & Write**). |
| `GITHUB_REPO_OWNER` | Next.js Server | Optional | `your-org` | GitHub username or organization owning the repo. |
| `GITHUB_REPO_NAME` | Next.js Server | Optional | `SidCrawal` | Repository name. |
| `GITHUB_CRAWLER_WORKFLOW_ID` | Next.js Server | Optional | `crawler-worker.yml` | Workflow filename inside `.github/workflows/`. |

---

## 5. Resend Email Delivery

| Variable | Scope | Required | Example / Format | How to Obtain / Notes |
| --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | Next.js Server only | Yes | `re_...` | Resend Dashboard -> **API Keys**. Sending-scoped keys work cleanly for all transactional delivery. |
| `EMAIL_FROM` | Next.js Server only | Yes | `SidCrawal Alerts <alerts@email.your-domain.com>` | Must match a domain verified in Resend (`Domains`). |

---

## 6. Upstash Redis Rate Limiting

| Variable | Scope | Required | Example / Format | How to Obtain / Notes |
| --- | --- | --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Next.js Server only | Recommended (Prod) | `https://...upstash.io` | Upstash Console -> Redis Database -> REST URL. |
| `UPSTASH_REDIS_REST_TOKEN` | Next.js Server only | Recommended (Prod) | `AX...` | Upstash Console -> Redis Database -> REST Token. Falls back gracefully to per-instance memory limiting in local dev/failover. |
