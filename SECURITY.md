# SidCrawal — Security Policy & Architecture Controls

Security is foundational to SidCrawal because crawling user-supplied URLs introduces high-risk attack surfaces (SSRF, DNS rebinding, arbitrary file reads, resource exhaustion, and tenant data leakage).

---

## 1. Server-Side Request Forgery (SSRF) Defense-in-Depth

Every URL entered by a user or followed during a redirect in either the Next.js API or the Playwright Worker MUST pass all checks below before fetching:

1. **Scheme Restriction:** Allow only `http:` and `https:`. Reject `file:`, `ftp:`, `gopher:`, `data:`, `javascript:`, `ws:`, `wss:`, and custom protocols.
2. **Credential Stripping / Rejection:** Reject URLs containing embedded username/password (`https://user:pass@host`) or non-standard ports unless explicitly permitted (`80`, `443`).
3. **DNS Resolution & IP Validation:**
   - Resolve target hostname via `dns.lookup(..., { all: true })` prior to opening a connection or launching a Playwright page route.
   - Block all resolved IPv4 and IPv6 addresses falling inside non-public ranges:
     - Loopback (`127.0.0.0/8`, `::1/128`)
     - Private / RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
     - Link-local & Cloud Metadata (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`)
     - Carrier-Grade NAT (`100.64.0.0/10`)
     - Unspecified / Multicast / Reserved (`0.0.0.0/8`, `224.0.0.0/4`, `240.0.0.0/4`, `::/128`, `fc00::/7`, `ff00::/8`, IPv4-mapped IPv6 `::ffff:0:0/96` unwrapped and checked against IPv4 blocks).
4. **Redirect & Subresource Validation:**
   - Intercept Playwright network requests (`page.route`) and re-validate every HTTP redirect (`3xx`) and cross-origin navigation hop against the DNS/IP allowlist to prevent DNS rebinding and open-redirect SSRF.

---

## 2. Browser Isolation & Resource Limits

- **Execution Timeout:** Hard navigation timeout (`20s`–`30s`) and total worker job timeout (`60s`) so hung streams cannot exhaust worker slots.
- **Page Size & Payload Limits:** Abort responses exceeding maximum byte thresholds (e.g., `15 MB` HTML/asset transfer cap) and limit DOM node serialization depth/count.
- **Browser Hardening:** Disable browser persistence (`incognito` / ephemeral `BrowserContext`), block local file access, strip service-worker registration where unneeded, and isolate one context per crawl job.
- **Concurrency Caps:** Enforce global worker concurrency and per-user `usage_limits` (`max_monitors`, `min_interval_minutes`, `max_monthly_crawls`).

---

## 3. Respectful Crawling & Anti-Bypass Policy

SidCrawal **must never** bypass:
- CAPTCHAs or anti-bot interstitials (e.g., Cloudflare Turnstile, reCAPTCHA, hCaptcha)
- Paywalls or subscriber-only content gates
- Authenticated login forms or private dashboards requiring session hijacking

When a crawl encounters an access gate or challenge, the worker stops immediately, leaves any existing baseline intact, and marks the run status as `blocked` with a clear diagnostic message.

---

## 4. Authentication, Authorization & Data Isolation

- **Row Level Security (RLS):** Enabled across all 10 tables in PostgreSQL. User queries execute exclusively with user-scoped JWTs (`auth.uid()`).
- **Private Storage:** Snapshots and diff PNGs reside in a private Supabase Storage bucket; access requires server-verified ownership and short-lived signed URLs.
- **Secret Hygiene:**
  - Never expose `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `BROWSER_WORKER_SECRET`, `CLOUDFLARE_DISPATCH_SECRET`, or GitHub dispatch tokens in `NEXT_PUBLIC_*` variables or client bundles.
  - Only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_URL` are safe for client exposure.
- **Rate Limiting:** Apply per-IP and per-user rate limits on auth endpoints, preview renders, and manual crawl triggers (implemented in Phases 2–6).
