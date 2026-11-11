# SidCrawal — Testing & Verification Guide

All code changes, lint checks, static typechecks, automated unit/integration tests, production build, and browser verifications follow the commands below.

---

## 1. Automated Verification Commands

```bash
# ESLint check across Next.js app, worker scripts, and tests
npm run lint

# TypeScript strict typechecks across all 3 packages
npm run typecheck
npm run worker:typecheck
npm --prefix cloudflare run typecheck

# Vitest unit, security, migration, route handler & UI component tests
npm test

# Production Next.js build (Webpack mode on Windows; Turbopack option also configured)
npm run build

# Safe production deployment readiness check (no secrets printed)
npm run verify:prod
```

---

## 2. Automated Test Coverage Overview (`src/**/*.test.{ts,tsx}`)

- **Authentication & RLS Migrations:**
  - `src/lib/auth/__tests__/errors-and-redirect.test.ts` — auth error mapping & open-redirect sanitization
  - `src/lib/auth/__tests__/proxy-and-profile.test.ts` — route guard proxy & profile defaults
  - `src/lib/auth/__tests__/auth-routes.test.ts` — login, register, verification resend, password recovery
  - `src/lib/auth/__tests__/migrations-rls.test.ts` — SQL migrations `0001`–`0005`, RLS across all tables including `api_error_events`, private `monitor-snapshots` Storage, `claim_due_crawl_jobs`, and `recover_stale_crawl_jobs`
  - `src/components/__tests__/auth-and-settings-ui.test.tsx` — interactive React auth & settings forms
  - `src/lib/__tests__/supabase-env.test.ts` & `src/lib/__tests__/url-validation.test.ts` — env detection & URL validation helpers
- **SSRF, Security & Rate Limiting:**
  - `src/lib/security/__tests__/ssrf-dns.test.ts` — IPv4/IPv6 CIDR private/metadata blocks & DNS resolution checks
  - `src/lib/security/__tests__/rate-limit.test.ts` — Upstash Redis sliding window, `429` headers, and graceful failover to local windows
- **Selection Workspace & Crawler Engine:**
  - `src/lib/preview/__tests__/selection-math.test.ts` — DOM element rects & region clamping
  - `src/components/__tests__/workspace-studio.test.tsx` & `src/components/__tests__/landing-preview.test.tsx` — selection workspace & landing preview UI
  - `src/lib/monitors/__tests__/monitors-and-preview-api.test.ts` — monitors CRUD & preview render API routes
  - `src/lib/crawler/__tests__/normalization-and-retry.test.ts` — timestamp stripping, regex/number normalization, exponential backoff
  - `src/lib/crawler/__tests__/persist-run.test.ts` — baseline creation, failed-crawl baseline preservation, duplicate change alert suppression
  - `src/lib/crawler/__tests__/concurrency-and-recovery.test.ts` — `BrowserConcurrencyLimiter` FIFO queue, `503 WORKER_QUEUE_FULL`, timeout handling, and per-user `max_concurrent_jobs` quota checks
  - `src/app/api/internal/__tests__/crawler-routes.test.ts` — internal dispatch, manual crawl trigger, and signed Storage URL validation
- **Resend Email Templates & Notification Pipeline:**
  - `src/lib/email/__tests__/templates-and-resend.test.ts` — verification, password reset, activation, digest, and change alert templates + PNG inline `cid:` attachments & Resend delivery
  - `src/app/api/internal/__tests__/notification-routes.test.ts` — internal notification drain & dashboard delivery log APIs
- **Admin Telemetry & Recovery:**
  - `src/app/api/admin/__tests__/admin-routes.test.ts` — admin role enforcement (`401`/`403`), live operational DB metrics + worker `/health` aggregation, stale lock recovery RPC, and non-blocking `recordApiErrorEvent`

---

## 3. Manual / Live Integration Checks

### Live Resend Email Delivery (`email.sidprep.in`)
```bash
npm run email:test-send -- recipient@example.com
```
Sends Verification, Password Reset, and Website Change Alert (with Playwright-rendered before, after, and `pixelmatch` diff PNG inline `cid:` attachments) via Resend. Note: sending-only scoped API keys (`RESEND_API_KEY`) successfully deliver emails while Resend GET log reads return `401 restricted_api_key`; check delivery logs directly in the Resend Dashboard when using a send-only key.

### Isolated Playwright Worker Local Smoke Check
```bash
npm run worker:dev
# In another shell:
curl http://127.0.0.1:4001/health
```
Verifies live Chromium discovery and worker concurrency metrics (`activeBrowsers`, `queuedRequests`, `maxConcurrent`, `maxQueueSize`).
