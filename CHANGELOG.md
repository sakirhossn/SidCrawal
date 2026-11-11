# Changelog

All notable changes to **SidCrawal** are documented in this file.

## [0.6.0] - Phase 6 Production Hardening, Rate Limiting, Concurrency & Admin Telemetry (2026-11-11)

### Added & Verified
- **Live Resend Email Delivery Check:** Upgraded `scripts/test-resend-email.ts` to capture real Playwright before/after + `pixelmatch` diff PNG screenshots and verified live Resend delivery (`alerts@email.sidprep.in`) across verification, password reset, and website change alert emails.
- **API Rate Limiting (`src/lib/security/rate-limit.ts`):** Integrated `@upstash/ratelimit` and `@upstash/redis` sliding-window limiters across auth endpoints (`/api/auth/login`, `/register`, `/forgot-password`, `/resend-verification`, `/reset-password`), `/api/preview/render`, `/api/monitors`, `/api/monitors/[id]/crawl`, `/api/admin/*`, and `/api/health`, returning standard `429` + `Retry-After` / `X-RateLimit-*` headers with graceful fail-open local fallback and non-blocking `api_error_events` logging.
- **Crawler Concurrency & Recovery (`worker/src/concurrency.ts`, `supabase/migrations/0005_phase6_concurrency_and_telemetry.sql`):**
  - Added bounded `BrowserConcurrencyLimiter` FIFO semaphore inside the Playwright worker (`WORKER_MAX_CONCURRENCY`), outer hard job timeout (`<= 45s`), queue overflow (`503 WORKER_QUEUE_FULL`), and live `/health` concurrency metrics.
  - Added per-user `usage_limits.max_concurrent_jobs` enforcement across manual crawls (`/api/monitors/[id]/crawl`) and scheduled RPC claims (`claim_due_crawl_jobs`), `CRAWL_CONCURRENCY` batch slicing (`worker/src/batch.ts`), duplicate queued/running guards, and `recover_stale_crawl_jobs(integer)` recovery without touching valid baselines.
- **Admin Operational Dashboard (`src/lib/admin/metrics.ts`, `/api/admin/overview`, `/api/admin/recover-jobs`, `/dashboard/admin`):** Implemented admin-gated real PostgreSQL + live worker telemetry covering registered users, active monitors, total/backlog crawl jobs, crawl run pass/fail/block/timeout counts, 24h detected changes, sent/failed/suppressed notifications, live worker `/health` latency/slots, stale lock recovery, and `api_error_events` audit logs (zero mock data).
- **Production Readiness & Security Headers:** Added HTTP security headers in `next.config.ts`, batch concurrency env defaults in `.github/workflows/crawler-worker.yml`, `npm run typecheck`, `npm run verify:prod` (`scripts/verify-production-readiness.ts`), and updated `.env.example` + full documentation (`docs/DEPLOYMENT.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/SECURITY.md`, `docs/TESTING.md`).

## [0.5.0] - Phase 5 Resend Integration & Responsive React Email Templates (2026-11-11)

### Added
- Integrated `resend` and `@react-email/components` under `src/lib/email/` (`client.ts`, `notifications.ts`) with domain verification guardrails and HTML + plain-text rendering.
- Built responsive React Email templates under `src/emails/` (`EmailLayout.tsx`, `VerifyEmail.tsx`, `PasswordResetEmail.tsx`, `MonitorActivatedEmail.tsx`, `ChangeAlertEmail.tsx`, `WeeklyDigestEmail.tsx`).
- Included before/after screenshots, pixel-comparison diff image (inline Resend `cid:` PNG attachments with signed Storage URL fallback), normalized text diff excerpts, detection timestamp, website title/URL, and SidCrawal links inside change alert emails.
- Integrated Resend custom verification/password-reset delivery into `/api/auth/register`, `/api/auth/resend-verification`, and `/api/auth/forgot-password`, monitor activation emails on monitor activation routes, and immediate/batch queue draining via `POST /api/internal/send-notifications` + `GET /api/notifications`.
- Connected `/dashboard/notifications` to RLS-scoped Postgres delivery logs and added `npm run email:test-send` (`scripts/test-resend-email.ts`) plus Phase 5 unit, route, and browser template render tests.

## [0.4.0] - Phase 4 Playwright Crawler Worker, Diff Engine & Scheduling (2026-11-11)

### Added
- Implemented independent Playwright crawler engine (`worker/src/crawler.ts`, `worker/src/diff.ts`, `worker/src/batch.ts`, `POST /crawl`) with element/multi-element/region extraction, full-page & cropped screenshots, and `pngjs` + `pixelmatch` visual diff mask generation (including dimension-mismatch union canvas padding).
- Refactored `worker/src/browser.ts` (`withGuardedBrowserPage`) and `worker/src/extractor.ts` (`CHALLENGE_DETECTION_EXPRESSION`) to share SSRF/DNS redirect validation, 15 MB transfer limit, timeout, and CAPTCHA/anti-bot challenge detection across preview and crawler modes.
- Implemented shared crawler orchestration modules under `src/lib/crawler/` (`normalization.ts`, `fingerprint.ts`, `retry.ts`, `persist-run.ts`, `run-monitor-crawl.ts`, `types.ts`) and constant-time secret verification (`src/lib/security/internal-auth.ts`, `src/lib/supabase/admin.ts`).
- Added `supabase/migrations/0004_crawler_scheduling_and_rpcs.sql` with immediate first-baseline scheduling, `claim_due_crawl_jobs` (`FOR UPDATE SKIP LOCKED` + stale lock recovery), and `increment_monthly_crawl_usage`.
- Added Phase 4 Route Handlers: `POST /api/internal/dispatch-due`, `POST /api/internal/crawl-results`, `POST /api/monitors/[id]/crawl`, `GET /api/monitors/[id]/history`, and `GET /api/snapshots/[id]/signed-url`.
- Added Cloudflare Cron dispatcher (`cloudflare/wrangler.toml`, `cloudflare/src/index.ts`) and GitHub Actions workflow (`.github/workflows/crawler-worker.yml`).
- Connected Monitor Details tabs (`Baseline Snapshot`, `Crawl Runs`, `Changes`, **Run Crawl Now** button), Change History (`/dashboard/history`), signed screenshot previews (`SignedSnapshotPreview`), and Workspace timestamp normalization control.
- Added automated Vitest suites (`normalization-and-retry.test.ts`, `persist-run.test.ts`, `crawler-routes.test.ts`, migration checks) and live controlled-website E2E Playwright verification (`baseline -> timestamp normalization -> 500 failure baseline preservation -> CAPTCHA block pause -> missing selector safe fail -> v2 text/visual diff -> deduplication -> region diff`).

## [0.3.0] - Phase 3 Isolated Browser Selection Workspace (2026-11-11)

### Added
- Built isolated Playwright browser rendering worker service under `worker/` (`package.json`, `tsconfig.json`, `Dockerfile`, `src/ssrf.ts`, `src/extractor.ts`, `src/browser.ts`, `src/server.ts`) with DNS/redirect SSRF defense, 15 MB page-size cap, configurable navigation timeout, anti-bot/CAPTCHA detection, verified CSS selector generation, and iframe restriction header reporting.
- Added shared IP-range CIDR validation (`src/lib/ip-ranges.ts`), server-side DNS SSRF validator (`src/lib/security/ssrf.ts`), selection geometry helpers (`src/lib/preview/selection-math.ts`), and worker HTTP client (`src/lib/preview/worker-client.ts`).
- Added `supabase/migrations/0003_monitor_activation_trigger.sql` to automatically sync `crawl_jobs` when monitors are activated or paused.
- Implemented Phase 3 API Route Handlers: `POST /api/preview/render`, `GET`/`POST /api/monitors`, `GET`/`PATCH`/`DELETE /api/monitors/[id]`, and `PUT /api/monitors/[id]/selection`.
- Built full interactive Website Selection Workspace (`WorkspaceStudio`), upgraded `Add Monitor`, and wired `Monitor Details` (`MonitorActionsBar`) for saving/editing selections and activating/pausing monitors.
- Added unit, SSRF/DNS, API, UI component tests, and live multi-website verification covering iframe-blocked public websites.

## [0.2.0] - Phase 2 Supabase Auth, Profiles & Row Level Security (2026-11-11)

### Added
- Created SQL migrations `supabase/migrations/0001_initial_schema.sql` (all 10 tables, indexes, constraints, `handle_new_user()` profile/settings/quota trigger) and `supabase/migrations/0002_rls_and_storage.sql` (strict RLS policies across all 10 tables, role-escalation protection trigger, private `monitor-snapshots` Storage bucket & object RLS).
- Added `supabase/README.md` setup and URL redirect configuration instructions.
- Implemented server-side auth utilities in `src/lib/auth/` (`schemas.ts`, `errors.ts`, `redirect.ts`, `http.ts`, `profile.ts`, `session.ts`) with open-redirect sanitization and clear error mapping.
- Implemented complete Supabase Auth Route Handlers: `/auth/callback`, `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/resend-verification`, and `/api/settings`.
- Added `/reset-password` page and connected `AuthForm`, `DashboardLayout` auth guard, `DashboardShell` logout & profile display, `SettingsForm`, and `/dashboard/admin` role check.
- Updated `src/proxy.ts` to protect `/dashboard/*`, enforce verified email confirmation, and redirect signed-in users away from `/login` and `/register`.
- Added automated Vitest unit, route-handler, proxy, migration/RLS, and UI component tests covering the authentication flows.

## [0.1.0] - Phase 1 Foundation & UI Shell (2026-11-11)

### Added
- Created core engineering documentation: `PRD.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `DEVELOPMENT_ROADMAP.md`, `SECURITY.md`, and `.env.example`.
- Initialized Next.js App Router + TypeScript + Tailwind CSS project structure.
- Established design system with Light & Dark themes, self-hosted `Geist` & `Geist_Mono` typography, `shadcn/ui` primitives, Lucide icons, and animated components (`@vengeanceui`, `@skiper-ui/skiper4`).
- Built premium Landing Page (`/`) with static interactive selection/diff preview (honestly labeled as Phase 1 preview; no live crawler connected yet) and client SSRF URL quickstart validation.
- Built Auth UI route scaffolds (`/login`, `/register`, `/verify-email`, `/forgot-password`) with `zod` validation and Supabase configuration status awareness.
- Built responsive Dashboard Shell & navigation across `/dashboard`, `/dashboard/monitors/new`, `/dashboard/workspace`, `/dashboard/monitors/[id]`, `/dashboard/history`, `/dashboard/notifications`, `/dashboard/settings`, and `/dashboard/admin`.
- Added `/api/health` readiness endpoint, `@supabase/ssr` client/server configuration scaffold, environment validator, `src/proxy.ts` request proxy, and `supabase/config.toml`.
- Added Vitest unit/component tests and verified all routes in desktop and mobile headless Chrome.
