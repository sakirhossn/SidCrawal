# SidCrawal — API Documentation

**Base URL:** `/api` (Next.js App Router Route Handlers)  
**Status Legend:**  
- `Phase 1 Scaffold` — Type contracts & design defined; endpoint implementation scheduled in later phase.  
- `Phase 2–5` — Active route handlers implemented per phase.

---

## 1. Authentication & Authorization Model

- **User Endpoints:** Authenticate via Supabase Auth HTTP-only session cookies (`@supabase/ssr`). Server handlers always verify identity with `supabase.auth.getUser()`, never trusting client-supplied `user_id`.
- **Worker / Scheduler Endpoints:** Authenticate via HMAC-SHA256 / bearer shared secrets (`CLOUDFLARE_DISPATCH_SECRET`, `BROWSER_WORKER_SECRET`) over HTTPS, plus timestamp replay protection.

---

## 2. Core Endpoints Overview

### 2.1 Health & Readiness
- **`GET /api/health`** *(Implemented: Phase 1)*
  - Returns service status, runtime readiness, and non-sensitive configuration indicators (`supabaseConfigured: boolean`, without leaking keys).

### 2.2 Authentication & Account Settings *(Implemented: Phase 2)*
- **`POST /api/auth/register`** — Validates `fullName`, `email`, `password` and registers user via Supabase Auth (`signUp`) with `/auth/callback` verification redirect.
- **`POST /api/auth/login`** — Authenticates via `signInWithPassword`, blocks unverified accounts (`403 EMAIL_NOT_CONFIRMED`), ensures profile rows exist, and returns sanitized `redirectTo`.
- **`POST /api/auth/logout`** — Signs out active Supabase SSR session and clears cookies.
- **`POST /api/auth/forgot-password`** — Dispatches password reset link redirecting to `/auth/callback?next=/reset-password`.
- **`POST /api/auth/reset-password`** — Verifies active recovery session and updates password via `updateUser`.
- **`POST /api/auth/resend-verification`** — Re-sends email ownership confirmation link.
- **`GET /auth/callback`** — Exchanges PKCE `code` or verifies `token_hash` + `type`, ensures `profiles` / `user_settings` rows exist, and redirects safely.
- **`GET` / `PATCH /api/settings`** — Reads or updates `profiles.full_name` and `user_settings` under RLS while enforcing `usage_limits.min_interval_minutes`.

### 2.3 Monitors CRUD *(Implemented: Phase 3)*
- **`GET /api/monitors`** — List authenticated user's monitors ordered by creation date.
- **`POST /api/monitors`** — Create a draft monitor after validating URL syntax, DNS/SSRF policy, and `usage_limits` (`max_monitors`, `min_interval_minutes`).
  - Body: `{ name: string, url: string, checkIntervalMinutes: number }`
  - Errors: `400 INVALID_URL`, `403 SSRF_BLOCKED_TARGET`, `429 QUOTA_EXCEEDED`.
- **`GET /api/monitors/[id]`** — Fetch single monitor and active `monitor_selections` row.
- **`PATCH /api/monitors/[id]`** — Update name, status (`draft` / `active` / `paused`), or check interval (enforces saved selection before activation).
- **`DELETE /api/monitors/[id]`** — Delete monitor under RLS.

### 2.4 Isolated Website Selection Preview *(Implemented: Phase 3)*
- **`POST /api/preview/render`**
  - Validates URL (HTTP/HTTPS only, DNS resolution check against private/internal IPs).
  - Invokes isolated Playwright preview worker (`BROWSER_WORKER_URL`, authenticating with `BROWSER_WORKER_SECRET`).
  - Returns `finalUrl`, `pageTitle`, `httpStatus`, `resolvedIp`, `frameBlockedByHeader`, `framePolicyHeader`, `viewport`, `documentDimensions`, `screenshotDataUrl`, and extracted `elements[]` with unique verified CSS selectors and bounding boxes.
  - Error Codes: `422 BLOCKED_BY_CHALLENGE` (CAPTCHA/anti-bot wall encountered — never bypassed), `403 SSRF_BLOCKED_TARGET`, `504 WORKER_TIMEOUT`, `503 WORKER_UNAVAILABLE`.

- **`PUT /api/monitors/[id]/selection`**
  - Deactivates previous active selections and inserts active `monitor_selections` row, optionally activating the monitor (`activate: true`, syncing `crawl_jobs` via trigger).

### 2.5 Crawler Scheduling, Diff Engine & Snapshot Artifacts *(Implemented: Phase 4)*
- **`POST /api/internal/dispatch-due`** *(Called by Cloudflare Worker Cron)*
  - Verifies `Authorization: Bearer <CLOUDFLARE_DISPATCH_SECRET>` with constant-time comparison.
  - Atomically claims due `crawl_jobs` via `claim_due_crawl_jobs` (`FOR UPDATE SKIP LOCKED`) and triggers `.github/workflows/crawler-worker.yml` (`workflow_dispatch`) or falls back to the standalone worker `/crawl` endpoint.
- **`POST /api/internal/crawl-results`** *(Called by Remote Playwright Worker)*
  - Verifies `Authorization: Bearer <BROWSER_WORKER_SECRET>`.
  - Uploads PNG artifacts to private `monitor-snapshots` Storage, records `crawl_runs` & `snapshots`, creates `detected_changes` when threshold is met, preserves active baseline on failed/blocked/timed-out crawls, updates retry backoff, and queues non-duplicate notifications.
- **`POST /api/monitors/[id]/crawl`**
  - Authenticated RLS-verified manual crawl trigger respecting monthly `usage_limits` quota.
- **`GET /api/monitors/[id]/history`**
  - Returns RLS-scoped `crawl_runs`, `snapshots`, and `detected_changes` for monitor `[id]`.
- **`GET /api/snapshots/[id]/signed-url?variant=element|full|diff`**
  - Verifies row ownership under RLS and issues a short-lived signed URL (`180s` TTL) from private `monitor-snapshots` Storage.

### 2.6 Resend Notifications & Delivery Logs *(Implemented: Phase 5)*
- **`POST /api/internal/send-notifications`** *(Internal Dispatcher Auth)*
  - Verifies `Authorization: Bearer <CLOUDFLARE_DISPATCH_SECRET>` and drains `status = 'queued'` rows in `notifications`, downloading private PNG screenshots from `monitor-snapshots` and sending inline CID-attached `ChangeAlertEmailTemplate` emails via Resend.
- **`GET /api/notifications`** — Returns authenticated user's RLS-scoped Resend delivery ledger rows (`queued`, `sent`, `failed`, `suppressed_duplicate`, `provider_message_id`).

### 2.7 Admin *(Planned: Phase 6)*
- **`GET /api/admin/overview`** — Admin-only aggregated operational health metrics (`profiles.role === 'admin'`, Phase 6).

---

## 3. Standard Error Response Envelope

```json
{
  "error": {
    "code": "SSRF_BLOCKED_TARGET",
    "message": "Target resolves to a private or reserved network address.",
    "details": {}
  }
}
```
