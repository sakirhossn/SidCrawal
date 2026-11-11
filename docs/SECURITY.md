# SidCrawal — Security Architecture & Controls

This document details all implemented security defenses across SidCrawal as of Phase 6. See also the root [Security Policy](../SECURITY.md).

---

## 1. SSRF, DNS Rebinding & Target Validation

User-supplied target URLs (`POST /api/preview/render`, `POST /api/monitors`, `PATCH /api/monitors/[id]`, and inside `worker/src/browser.ts`) pass layered validation:
- **Scheme & Credential Rejection (`src/lib/security/ssrf.ts`, `worker/src/ssrf.ts`):** Only `http:` and `https:` are allowed; embedded URL credentials (`user:pass@`) and non-standard ports outside `80`/`443` (excluding dev explicit tests where blocked anyway) are rejected.
- **CIDR Blocklist (`src/lib/ip-ranges.ts`):** Resolves hostnames via `dns.lookup(..., { all: true })` and blocks loopback (`127.0.0.0/8`, `::1/128`), private RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), ULA (`fc00::/7`), multicast/unspecified ranges, and unwrapped IPv4-mapped IPv6 addresses (`::ffff:0:0/96`).
- **Playwright Request Interception (`worker/src/browser.ts`):** Every navigation hop, redirect (`3xx`), and subresource fetch passes live validation before Playwright completes network requests; payloads exceeding `15 MB` are aborted.
- **Audit Logging:** Blocked SSRF attempts (`403 SSRF_BLOCKED_TARGET`) are logged to `public.api_error_events` via `recordApiErrorEvent` for visibility in `/dashboard/admin`.

---

## 2. Ethical Crawling & Anti-Bypass Guarantees

- SidCrawal **never** attempts to solve or evade CAPTCHAs (Cloudflare Turnstile, reCAPTCHA, hCaptcha), paywalls, or private login barriers (`worker/src/extractor.ts` challenge detection).
- When a crawl hits an access wall or fails network/selector verification:
  - `active_baseline_snapshot_id` is **never overwritten** (`src/lib/crawler/persist-run.ts` & `recover_stale_crawl_jobs`).
  - Crawl run is marked `blocked`, `timeout`, or `failed` and scheduled into bounded exponential backoff.

---

## 3. API Rate Limiting (`src/lib/security/rate-limit.ts`)

Sliding-window limits backed by `@upstash/ratelimit` + `@upstash/redis` (with automatic fail-open local sliding-window fallback if Redis is unconfigured or offline):

| Policy | Window Limit | Protected Endpoints |
| --- | --- | --- |
| `auth_login` | 10 / 1m | `POST /api/auth/login` |
| `auth_register` | 5 / 15m | `POST /api/auth/register` |
| `auth_recovery` | 5 / 15m | `/api/auth/forgot-password`, `/api/auth/resend-verification`, `/api/auth/reset-password` |
| `preview_render` | 15 / 1m | `POST /api/preview/render` |
| `monitor_crawl` | 6 / 1m | `POST /api/monitors/[id]/crawl` |
| `monitor_write` | 20 / 1m | `POST /api/monitors`, `/api/admin/overview`, `/api/admin/recover-jobs` |
| `public_health` | 60 / 1m | `GET /api/health` |

All rate-limited responses emit standard `429 RATE_LIMIT_EXCEEDED` JSON + `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers and log events to `api_error_events`.

---

## 4. Authentication, Admin Access & Row Level Security

- **Verified Session Gate:** `src/proxy.ts`, Dashboard Server Components (`src/lib/auth/session.ts`), and Route Handlers verify `supabase.auth.getUser()` and require `email_confirmed_at` before dashboard/monitor operations.
- **Row Level Security (`supabase/migrations/0002_rls_and_storage.sql`, `0005_phase6_concurrency_and_telemetry.sql`):**
  - Strictly isolates all user tables (`profiles`, `user_settings`, `usage_limits`, `monitors`, `monitor_selections`, `crawl_jobs`, `crawl_runs`, `snapshots`, `detected_changes`, `notifications`) to `auth.uid() = user_id`.
  - `prevent_profile_role_escalation` trigger rejects user-initiated changes to `profiles.role`.
  - `public.api_error_events` enables RLS with zero user policies (strictly accessible to `service_role` behind verified admin role checks).
- **Admin Endpoints (`/api/admin/overview`, `/api/admin/recover-jobs`, `/dashboard/admin`):** Enforce `profiles.role === 'admin'` server-side, returning `401` / `403` to non-admin users.
- **Private Storage:** Snapshot PNGs are written only to the private `monitor-snapshots` bucket; user downloads require RLS ownership validation followed by short-lived signed Storage URLs.
- **HTTP Security Headers (`next.config.ts`):** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and restrictive `Permissions-Policy`.

---

## 5. Worker Concurrency & Secrets Hygiene

- **Worker Semaphore (`worker/src/concurrency.ts`):** Caps concurrent Chromium launches per worker (`WORKER_MAX_CONCURRENCY`, default `2`, max `8`), queues bursts cleanly (max queue `20`), and enforces hard job timeouts (`<= 45s` outer race).
- **Per-User Concurrency Quota:** `usage_limits.max_concurrent_jobs` limits simultaneous queued/running crawls per user in both `POST /api/monitors/[id]/crawl` and `claim_due_crawl_jobs(...)`.
- **Internal Auth (`src/lib/security/internal-auth.ts`):** Uses `crypto.timingSafeEqual` over Bearer secrets (`CLOUDFLARE_DISPATCH_SECRET`, `BROWSER_WORKER_SECRET`).
