# SidCrawal — System Architecture

**Status:** Phase 5 Complete (Phases 1–5 implemented: Next.js Web App, Supabase Auth & RLS, Playwright Selection Workspace, Playwright Crawler + Pixel/Text Diff + Scheduling, and Resend + React Email Notifications; Phase 6 security/ops launch readiness next).

---

## 1. High-Level Topology

```text
+-------------------------------------------------------------------------+
|                        CLIENT & WEB TIER (Vercel)                       |
|   Next.js App Router (TypeScript, Tailwind CSS, shadcn/ui, Lucide)      |
|   - Landing & Auth UI                                                   |
|   - Dashboard & Selection Workspace UI                                  |
|   - Route Handlers (/api/*) for validation, monitor CRUD, signed URLs   |
+-------------------+---------------------------------+-------------------+
                    |                                 |
                    v                                 v
+-----------------------------------+   +---------------------------------+
|      SUPABASE PLATFORM            |   |    ISOLATED BROWSER SERVICE     |
|  - Supabase Auth (JWT + cookies)  |   |  (Node.js + Playwright Worker)  |
|  - PostgreSQL + RLS (10 tables)   |   |  - URL/DNS/SSRF Gate            |
|  - Supabase Storage (private      |   |  - Headless Chromium Render     |
|    buckets for snapshots & diffs) |   |  - DOM Tree + Bounding Boxes    |
+-------------------+---------------+   +---------------------------------+
                    ^                                 ^
                    |                                 |
+-------------------+---------------+                 |
|    SCHEDULING TIER (Cloudflare)   |                 |
|  - Cloudflare Workers + Cron      |-----------------+
|  - Polls due crawl_jobs           |  Signed workflow_dispatch / webhook
|  - Enforces dispatch concurrency  |
+-------------------+---------------+
                    |
                    v
+-----------------------------------+   +---------------------------------+
|   CRAWLER EXECUTION (GitHub       |   |      NOTIFICATION TIER          |
|   Actions -> Playwright Worker)   |-->|  - Resend API                   |
|  - Baseline & periodic captures   |   |  - React Email templates        |
|  - Text & pixel diff comparison   |   |  - Signed snapshot URLs / CID   |
|  - Uploads artifacts to Storage   |   +---------------------------------+
+-----------------------------------+
```

---

## 2. Component Responsibilities

### 2.1 Web Application (Next.js App Router on Vercel)
- **Presentation Layer:** Server Components for authenticated data loading (`@supabase/ssr`), Client Components for interactive selection canvas, theme switching (`next-themes`), and real-time status states.
- **API & Guard Layer:** Route Handlers validate inputs via `zod`, verify Supabase JWT sessions, check user quotas (`usage_limits`), apply SSRF pre-checks, and issue short-lived signed storage URLs.
- **Request Interception:** Next.js `proxy.ts` refreshes Supabase auth cookies on navigation and protects `/dashboard/*` routes once Supabase credentials are active.

### 2.2 Persistence & Auth (Supabase)
- **Supabase Auth:** Handles user registration, email verification tokens, password resets, and session JWTs.
- **PostgreSQL + RLS:** Enforces strict tenant isolation (`auth.uid() = user_id`) on every user-owned resource. Service-role keys are restricted exclusively to server-side worker/admin contexts and never shipped to browser bundles.
- **Supabase Storage:** Private buckets store baseline screenshots, latest run screenshots, element crops, and generated visual diff PNGs. Access is mediated via authenticated server-generated signed URLs.

### 2.3 Website Selection Service (Isolated Browser Renderer — Phase 3)
- Why no pure `iframe`? External websites routinely send `X-Frame-Options: DENY/SAMEORIGIN` or `Content-Security-Policy: frame-ancestors 'none'`, breaking interactive DOM selection.
- Instead, the Next.js workspace sends a validated URL to an isolated Playwright preview worker (`BROWSER_WORKER_URL` signed with `BROWSER_WORKER_SECRET`).
- The worker navigates within strict SSRF/size/timeout bounds, captures a high-DPI viewport screenshot plus serialized bounding-box/selector telemetry for visible interactive DOM nodes, and returns that sanitized inspection package to the browser canvas.
- Users hover/click elements or drag visual rectangles over the captured interactive overlay—no cross-origin script injection or iframe errors.

### 2.4 Scheduler & Crawler Execution (Cloudflare + GitHub Actions — Phase 4)
1. **Cloudflare Cron Trigger** runs on a 1-minute or 5-minute schedule.
2. **Cloudflare Worker** queries eligible `crawl_jobs` where `next_run_at <= now()` and `status = 'idle'` (via secure RPC / API endpoint), respecting global concurrency and per-plan intervals.
3. **Dispatch:** Worker triggers GitHub Actions `workflow_dispatch` (initial crawler execution runner) with signed job batch metadata, marking jobs as `queued`.
4. **Playwright Worker** acquires each job, enforces DNS/IP SSRF validation on every request and redirect, loads the page in Chromium, extracts HTML/text + element/full-page screenshots, normalizes dynamic content, and diffs against the latest valid baseline `snapshots` row.
5. **Failure Isolation:** Failed crawls log errors in `crawl_runs`, schedule bounded retries, and **never overwrite** the active baseline snapshot.

### 2.5 Email Pipeline (Resend + React Email — Phase 5)
- Triggered only when a meaningful change passes threshold rules and its `change_hash` differs from the most recent notified change for that selection.
- Renders strongly-typed React Email components with inline-safe summary data, before/after screenshot previews, visual diff asset, text diff snippet, and history link.
- Records delivery attempt and provider message ID in `notifications`.

---

## 3. Repository Structure (Target Evolution)

```text
SidCrawal/
├── PRD.md
├── SYSTEM_ARCHITECTURE.md
├── DATABASE_SCHEMA.md
├── API_DOCUMENTATION.md
├── DEVELOPMENT_ROADMAP.md
├── SECURITY.md
├── CHANGELOG.md
├── .env.example
├── package.json
├── supabase/
│   ├── config.toml
│   └── migrations/          # Phase 2 SQL migrations & RLS
├── src/
│   ├── app/                 # Next.js App Router pages & API route handlers
│   ├── components/          # shadcn/ui, Vengeance UI, Skiper UI & domain UI
│   ├── lib/                 # Supabase clients, URL/SSRF validators, utilities
│   └── proxy.ts             # Session refresh & auth route protection
├── worker/                  # Phase 3-4 isolated Node.js Playwright worker
├── cloudflare/              # Phase 4 Cron Trigger dispatcher worker
└── .github/workflows/       # Phase 4 crawler execution workflow & CI checks
```
