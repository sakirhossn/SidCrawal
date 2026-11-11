# SidCrawal — Development Roadmap

Development proceeds **strictly one phase at a time**, with verification (app run, lint, TypeScript check, automated tests, browser check, documentation sync) completed at the end of every phase before moving on.

---

## Phase 1: Foundation, Design System & Dashboard Shell *(Completed)*
- **Docs & Security Blueprint:** `PRD.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `DEVELOPMENT_ROADMAP.md`, `SECURITY.md`, `.env.example`, `CHANGELOG.md`.
- **Next.js Application:** App Router, TypeScript strict mode, Tailwind CSS, `shadcn/ui`, Lucide icons, `motion`, `@vengeanceui` & free `@skiper-ui` UI components.
- **Design System:** Light/dark theme switcher, precision surface/border/type scale, accessible primitives, zero decorative bloat.
- **Frontend Shells:**
  - Premium Landing Page (`/`) with static interactive workflow preview.
  - Auth UI scaffolds (`/login`, `/register`, `/verify-email`, `/forgot-password`).
  - Responsive Dashboard shell + navigation covering `/dashboard`, `/dashboard/monitors/new`, `/dashboard/workspace`, `/dashboard/monitors/[id]`, `/dashboard/history`, `/dashboard/notifications`, `/dashboard/settings`, `/dashboard/admin`.
- **Supabase Scaffold:** `@supabase/ssr` client/server factories, env validator, request proxy, `supabase/config.toml` placeholder.

## Phase 2: Database Migrations, RLS & Authentication *(Completed)*
- Created SQL migrations (`0001_initial_schema.sql`, `0002_rls_and_storage.sql`) for all 10 tables, triggers (`handle_new_user`, `prevent_profile_role_escalation`), indexes, private `monitor-snapshots` bucket, and strict RLS policies.
- Integrated full Supabase Auth routes and UI flows: registration, email verification callback & resend, login/logout, forgot password, `/reset-password`, session refresh, and protected dashboard routes (`src/proxy.ts` + server guard).
- Connected Dashboard Overview, User Settings (`GET`/`PATCH /api/settings`), and server-verified Admin role check to RLS-scoped Postgres queries.

## Phase 3: Isolated Browser Selection Workspace *(Completed)*
- Built standalone Node.js + Playwright preview worker (`/worker`) with SSRF, DNS resolution, redirect hop validation, page-size cap, timeout, and anti-bot/CAPTCHA challenge detection (`422 BLOCKED_BY_CHALLENGE`).
- Implemented `/api/preview/render`, `/api/monitors`, `/api/monitors/[id]`, `/api/monitors/[id]/selection`, and `0003_monitor_activation_trigger.sql` (`crawl_jobs` sync).
- Built interactive Selection Canvas: hover-to-highlight DOM elements, click-to-select, multi-element selection, drag rectangle visual region selection, verified CSS selector generation, DOM node list browser, normalization preview, save/edit selection, and monitor activation.

## Phase 4: Crawler Worker, Diff Engine & Scheduling *(Completed)*
- Built independent Playwright crawler & comparison engine (`worker/src/crawler.ts`, `worker/src/diff.ts`, `worker/src/batch.ts`, `POST /crawl`) with baseline capture, periodic visits, element/multi-element/region extraction, `pngjs` + `pixelmatch` visual diff masks, and SHA-256 content/visual hashing.
- Implemented shared dynamic content normalization (`src/lib/crawler/normalization.ts`), bounded exponential retry backoff (`src/lib/crawler/retry.ts`), `change_fingerprint` duplicate-alert suppression (`src/lib/crawler/fingerprint.ts`), and atomic persistence (`src/lib/crawler/persist-run.ts`) that guarantees valid baselines are never overwritten on failed/blocked/timed-out crawls.
- Added `supabase/migrations/0004_crawler_scheduling_and_rpcs.sql` (`claim_due_crawl_jobs` with `FOR UPDATE SKIP LOCKED`, stale lock recovery, monthly quota accounting, and immediate initial-baseline trigger), internal dispatcher/callback APIs (`/api/internal/dispatch-due`, `/api/internal/crawl-results`, `/api/monitors/[id]/crawl`, `/api/monitors/[id]/history`, `/api/snapshots/[id]/signed-url`), Cloudflare Cron worker (`cloudflare/`), and GitHub Actions workflow (`.github/workflows/crawler-worker.yml`).

## Phase 5: Resend Email Templates & Notification Pipeline *(Completed)*
- Integrated `resend` and `@react-email/components` (`src/lib/email/client.ts`, `src/lib/email/notifications.ts`) with responsive HTML + plain-text rendering (`EmailLayout`, `VerifyEmailTemplate`, `PasswordResetEmailTemplate`, `MonitorActivatedEmailTemplate`, `ChangeAlertEmailTemplate`, `WeeklyDigestEmailTemplate`).
- Wired Resend delivery into email verification/resend/password reset routes (via Supabase Admin `generateLink`), monitor activation confirmations, immediate & queued change alerts with inline PNG before/after/comparison attachments (`contentId` CIDs + signed Storage URL fallback), `POST /api/internal/send-notifications`, `GET /api/notifications`, `/dashboard/notifications`, and `npm run email:test-send`.

## Phase 6: Security Hardening, Rate Limiting, Admin & Launch Readiness *(Next Phase)*
- Add endpoint rate limiting, crawl concurrency controls, and SSRF test suite.
- Complete Admin Dashboard operational metrics and error/abuse controls.
- Run full E2E verification, Lighthouse/accessibility audit, and deployment runbooks (Vercel + Supabase + Cloudflare + GitHub Actions).
