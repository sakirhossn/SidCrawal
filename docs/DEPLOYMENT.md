# SidCrawal — Production Deployment Guide

This guide covers deploying **SidCrawal** across its four runtime components:
1. **Supabase** (PostgreSQL database, Auth, Row Level Security, Private Storage)
2. **Isolated Browser Worker** (`worker/` — Node.js + Playwright Chromium HTTP service & batch runner)
3. **Vercel Frontend & API** (Next.js App Router)
4. **Cloudflare Workers + GitHub Actions** (Periodic Cron scheduler & fallback batch runner)

See [`docs/ENVIRONMENT_VARIABLES.md`](./ENVIRONMENT_VARIABLES.md) for how to populate every secret cleanly.

---

## 1. Supabase Setup (Database, Auth & Private Storage)

1. Create a new Supabase project at [supabase.com](https://supabase.com/dashboard).
2. Run SQL migrations in exact numeric order inside the SQL Editor (or via Supabase CLI `supabase db push`):
   - `supabase/migrations/0001_initial_schema.sql` — 10 core tables (`profiles`, `user_settings`, `usage_limits`, `monitors`, `monitor_selections`, `crawl_jobs`, `crawl_runs`, `snapshots`, `detected_changes`, `notifications`) + `handle_new_user()` trigger
   - `supabase/migrations/0002_rls_and_storage.sql` — strict tenant RLS policies, `prevent_profile_role_escalation` trigger, and private `monitor-snapshots` Storage bucket + object RLS
   - `supabase/migrations/0003_monitor_activation_trigger.sql` — automatic `crawl_jobs` state sync when activating/pausing monitors
   - `supabase/migrations/0004_crawler_scheduling_and_rpcs.sql` — `claim_due_crawl_jobs` (`FOR UPDATE SKIP LOCKED`), immediate baseline scheduling, and `increment_monthly_crawl_usage`
   - `supabase/migrations/0005_phase6_concurrency_and_telemetry.sql` — `usage_limits.max_concurrent_jobs`, `public.api_error_events` + RLS, `recover_stale_crawl_jobs(integer)`, and per-user concurrency fair-share claiming
3. Configure **Authentication -> URL Configuration**:
   - **Site URL:** `https://your-production-domain.com`
   - **Redirect URLs:**
     - `http://localhost:3000/auth/callback`
     - `https://your-production-domain.com/auth/callback`
     - `https://your-production-domain.com/reset-password`
4. **Promote an Initial Admin User:**
   Sign up normally and verify your email, then run in Supabase SQL Editor (the RLS trigger permits privilege elevation only via DB owner/SQL Editor):
   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'admin@your-domain.com';
   ```

---

## 2. Isolated Browser Worker (`worker/`)

Deploy `worker/Dockerfile` to a container host supporting Playwright Chromium (`Fly.io`, `Railway`, `Render`, or Cloud Run):

- **Exposed Port:** `4001` (or `PORT` injected by your container platform)
- **Health Check:** `GET /health` -> returns `{ ok, chromiumAvailable, concurrency }`
- **Worker Secrets & Tuning:**
  - `BROWSER_WORKER_SECRET` (shared 64-hex Bearer token matching Next.js)
  - `WORKER_MAX_CONCURRENCY=2` (bounded `1..8` parallel Chromium instances per container)
  - `NODE_ENV=production`

For Docker/container execution, install Playwright system libs cleanly via the multi-stage/Chromium Playwright base image already declared in `worker/Dockerfile`.

---

## 3. Vercel Frontend & Next.js API

1. Connect the repository to [Vercel](https://vercel.com) (Root Directory: `.`).
2. Add all required **Environment Variables** from [`docs/ENVIRONMENT_VARIABLES.md`](./ENVIRONMENT_VARIABLES.md) under Production + Preview scopes (never prefix server secrets with `NEXT_PUBLIC_`).
3. Verify build settings:
   - **Install Command:** `npm ci`
   - **Build Command:** `npm run build`
   - **Output Directory:** `.next`
4. Verify security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`) configured in [`next.config.ts`](../next.config.ts).
5. Confirm `GET https://your-domain.com/api/health` returns `200 OK` with `"configured": true` for every integration.

---

## 4. Resend Email Domain

1. Add and verify your sending domain (e.g. `alerts@email.your-domain.com`) with SPF/DKIM DNS records in [Resend](https://resend.com).
2. Store `RESEND_API_KEY` and `EMAIL_FROM` in Vercel / Next.js server environment variables.
3. Validate live delivery safely using:
   ```bash
   npm run email:test-send -- your-recipient@example.com
   ```

---

## 5. Upstash Redis Rate Limiting

1. Create a Redis database at [console.upstash.com](https://console.upstash.com).
2. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Vercel environment variables.
3. Auth (`login`, `register`, `forgot-password`, `resend-verification`, `reset-password`), `preview/render`, `monitors`, `monitors/[id]/crawl`, and `/api/health` automatically use Upstash sliding-window policies when configured and fail open to local in-memory windows if Redis is temporarily unreachable.

---

## 6. Cloudflare Cron Dispatcher & GitHub Actions Crawler

1. **Cloudflare Worker (`cloudflare/`):**
   - Configure `NEXT_APP_URL` in `cloudflare/wrangler.toml` `[vars]` or Cloudflare Dashboard.
   - Set secret:
     ```bash
     cd cloudflare
     npx wrangler secret put CLOUDFLARE_DISPATCH_SECRET
     npx wrangler deploy
     ```
   - Runs every 5 minutes (`*/5 * * * *`), calling `POST ${NEXT_APP_URL}/api/internal/dispatch-due`.

2. **GitHub Actions Crawler Fallback / Batch Execution (`.github/workflows/crawler-worker.yml`):**
   - Configure GitHub Repository Secrets (`Settings -> Secrets and variables -> Actions`):
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `NEXT_PUBLIC_APP_URL`
     - `CLOUDFLARE_DISPATCH_SECRET`
   - Optionally configure Vercel with `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_CRAWLER_WORKFLOW_ID` if dispatching crawls via GitHub Actions `workflow_dispatch` instead of direct HTTP `BROWSER_WORKER_URL`.

---

## 7. Pre-Release Verification Check

Run the local readiness audit script anytime (safe boolean checks only — zero secrets printed):

```bash
npm run verify:prod
```
