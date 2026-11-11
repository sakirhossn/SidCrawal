# SidCrawal — Product Requirements Document (PRD)

**Product Name:** SidCrawal  
**Document Status:** Phase 1 Foundation  
**Target Stack:** Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, Supabase (Auth, PostgreSQL, Storage, RLS), Node.js + Playwright (Chromium Worker), Cloudflare Workers (Cron Triggers), GitHub Actions, Resend + React Email, Vercel.

---

## 1. Product Objective

**SidCrawal** is a precision website monitoring and change detection SaaS platform. Registered users monitor public web pages and receive automatic email notifications—with before-and-after screenshots, visual diffs, and text comparisons—whenever specific DOM elements or visual regions change.

Unlike simple uptime pingers or naive `curl` HTML diff tools, SidCrawal renders pages inside an isolated Playwright Chromium browser, enables interactive element/region selection without relying on fragile third-party `iframe` embedding, normalizes transient noise, preserves successful baselines when crawls fail, and deduplicates identical change alerts.

---

## 2. Target Users & Primary Jobs-to-be-Done

| Persona | Use Case | Primary Value |
|---|---|---|
| **Product & Growth Teams** | Track competitor pricing tables, release notes, and hero messaging | Visual + text proof of exact section changes |
| **Engineering & Compliance** | Monitor public status pages, legal terms, privacy policies, and SLA disclosures | Auditable change history and baseline snapshots |
| **Operations & Procurement** | Watch supplier stock statuses, regulatory bulletins, or public RFPs | Timely alerts with low false-positive noise |

---

## 3. End-to-End User Journey

1. **Register:** User signs up with email and password.
2. **Verify Email:** User verifies ownership via verification email before activating monitors.
3. **Log In:** Authenticated user lands on the SidCrawal Dashboard.
4. **Enter URL:** User provides a public `http://` or `https://` URL (validated against SSRF/private IP rules).
5. **Load Isolated Preview:** Browser-rendering worker loads the page in Chromium and streams/returns an interactive DOM & visual representation (not purely iframe-dependent).
6. **Select Target:** User hovers to highlight DOM elements, clicks to select one or multiple CSS selectors, or drags a bounding-box visual region; inspects the extracted preview and saves the selection.
7. **Configure Frequency:** User chooses crawl cadence (subject to plan/usage limits), normalization preferences, and notification settings.
8. **Activate Monitoring:** Baseline crawl captures initial HTML, extracted text, element screenshot, and full-page screenshot; activation confirmation email is sent.
9. **Automated Crawl & Diff:** Cloudflare Cron Triggers dispatch due jobs to the Playwright worker (initially via GitHub Actions); worker compares normalized text and visual pixels against the active baseline without overwriting baselines on error.
10. **Receive Alert:** On meaningful change (and non-duplicate fingerprint), Resend delivers a structured email with title, URL, timestamp, before/after screenshots, visual diff image, text diff, and direct link to monitor history.

---

## 4. Functional Requirements

### 4.1 Authentication & Account Lifecycle (Phase 2)
- Email/password registration with mandatory email verification.
- Password reset flow.
- Role-aware profile management (`user`, `admin`) via Supabase Auth + `profiles` table.
- Per-user preferences (`user_settings`) and quota enforcement (`usage_limits`).

### 4.2 Website Selection Workspace (Phase 3 — Core Feature)
- URL entry, syntax validation, and SSRF/DNS pre-check.
- Isolated Playwright rendering service generating interactive DOM overlay metadata + rendered viewport capture (bypassing `X-Frame-Options` / `CSP frame-ancestors` limitations cleanly without embedding third-party frames blindly).
- Loading, timeout, blocked-site (CAPTCHA/paywall), and error states with clear recovery UX.
- Hover-to-highlight DOM nodes, click-to-select, multi-element selection, and rectangular bounding-box region selection.
- Robust CSS selector generation and selected-element text/metadata preview.
- Persisted selection payload: `url`, `css_selector`, `element_metadata`, `selection_type` (`element` | `multi_element` | `region`), `bounding_box`, `viewport_dimensions`, `selected_text`.

### 4.3 Crawler & Change Detection Engine (Phase 4)
- Isolated Node.js + Playwright Chromium worker process.
- Initial baseline capture (full-page + element screenshots, HTML excerpt, normalized text, content hash).
- Periodic crawling orchestrated by Cloudflare Workers + Cron Triggers dispatching to GitHub Actions (initial worker execution target).
- Dynamic-content normalization (whitespace collapsing, configurable noise patterns such as timestamps/counters).
- Combined text comparison and pixel/visual comparison.
- **Invariant 1:** Never overwrite a successful baseline when a crawl attempt fails.
- **Invariant 2:** Suppress duplicate notifications for identical consecutive change fingerprints.
- **Invariant 3:** Never bypass CAPTCHAs, login walls, paywalls, or anti-bot challenges; record explicit blocked status.

### 4.4 Email Notifications (Phase 5)
- Powered by Resend API + React Email templates.
- Templates: Verification, Password Reset, Monitoring Activated, Website Change Detected, Optional Weekly Summary.
- Change alert payload includes: Website title, URL, detection timestamp, previous screenshot, current screenshot, visual diff, previous vs. updated text, and deep link to Change History.

### 4.5 Dashboard, History & Admin (Phases 1–6)
- Landing page, Auth screens, Dashboard overview, Add Monitor, Selection Workspace, Monitor Details, Change History, Notification History, User Settings, and Admin Dashboard.
- Light & dark modes, full mobile & desktop responsiveness, WCAG-compliant accessible primitives.

---

## 5. Non-Functional Requirements

- **Security:** Strict SSRF prevention (DNS resolution + redirect verification + private CIDR blocks), HTTP/HTTPS-only, strict browser timeouts, page size caps, concurrency caps, rate limiting, Supabase RLS on all user tables, private storage access via signed URLs.
- **Reliability:** Idempotent job dispatch, exponential retry backoff on transient network failures, immutable audit history (`crawl_runs`, `detected_changes`, `notifications`).
- **Transparency (No Mock Claims):** Each phase clearly isolates implemented capabilities from pending integrations. Phase 1 delivers the Next.js application shell, design system, landing page, responsive navigation, documentation, and Supabase configuration scaffold without fake crawling.
