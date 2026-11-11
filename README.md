# SidCrawal — Website Monitoring & Change Detection SaaS

SidCrawal enables registered users to monitor public websites by selecting specific DOM elements or visual regions inside an isolated Playwright Chromium preview, then delivering before-and-after screenshot alerts via Resend when meaningful changes are detected.

**Current Status:** **Phase 6 Complete (Production Hardening, Live Resend Verification, Rate Limiting, Concurrency Controls & Admin Telemetry)** — codebase production-ready; final external cloud provisioning (Supabase project keys, Cloudflare Wrangler deploy, Vercel production deploy, Upstash Redis credentials) awaiting user credentials/approval.

---

## Documentation

- [Product Requirements Document](./PRD.md)
- [System Architecture](./SYSTEM_ARCHITECTURE.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Development Roadmap](./DEVELOPMENT_ROADMAP.md)
- [Security Policy](./SECURITY.md) & [Detailed Security Controls](./docs/SECURITY.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)
- [Environment Variables Reference](./docs/ENVIRONMENT_VARIABLES.md)
- [Testing & Verification Guide](./docs/TESTING.md)
- [Changelog](./CHANGELOG.md)

---

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment template and configure Supabase credentials (see [supabase/README.md](./supabase/README.md) for SQL migration & auth redirect setup):
   ```bash
   cp .env.example .env.local
   ```
3. Run development server:
   ```bash
   npm run dev
   ```
   *(Configured with `--webpack` + `@tailwindcss/postcss` for reliable Windows compatibility; `npm run dev:turbopack` and `npm run build:turbopack` are also available.)*
4. Open [http://localhost:3000](http://localhost:3000).

## Verification Commands

```bash
npm run lint
npm run typecheck
npm run worker:typecheck
npm --prefix cloudflare run typecheck
npm test
npm run build
npm run verify:prod
```

## UI & Credits

- Built with Next.js App Router, TypeScript, Tailwind CSS v4, `shadcn/ui` (`@base-ui/react`), Lucide icons, and Framer Motion.
- Animated button primitives adapted from [Vengeance UI](https://www.vengenceui.com/).
- Theme toggle SVG animation adapted from [Skiper UI](https://skiper-ui.com/) (`@skiper-ui/skiper4`) and [toggles.dev](https://toggles.dev/).
