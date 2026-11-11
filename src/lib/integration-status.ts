import { isUpstashRateLimitConfigured } from "@/lib/security/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface IntegrationStatusItem {
  id: string;
  label: string;
  provider: string;
  phase: string;
  configured: boolean;
  note: string;
}

const PLACEHOLDER_TOKENS = ["placeholder", "your-"];

function hasConfiguredSecret(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  return !PLACEHOLDER_TOKENS.some((token) => trimmed.includes(token));
}

/**
 * Server-only helper returning safe boolean readiness flags for external integrations.
 * Never returns raw credential values or secrets.
 */
export function getServerIntegrationStatus(): IntegrationStatusItem[] {
  return [
    {
      id: "supabase-auth",
      label: "Database & Auth",
      provider: "Supabase (PostgreSQL + RLS)",
      phase: "Phase 2",
      configured: isSupabaseConfigured(),
      note: "Auth routes & SQL migrations implemented; connect .env.local credentials to activate.",
    },
    {
      id: "browser-worker",
      label: "Isolated Browser Renderer",
      provider: "Node.js + Playwright Chromium",
      phase: "Phase 3",
      configured:
        hasConfiguredSecret(process.env.BROWSER_WORKER_URL) &&
        hasConfiguredSecret(process.env.BROWSER_WORKER_SECRET),
      note: "Playwright selection worker implemented in worker/; start locally with npm run worker:dev or set BROWSER_WORKER_URL.",
    },
    {
      id: "scheduler",
      label: "Cron Scheduler & Crawler",
      provider: "Cloudflare Workers + GitHub Actions",
      phase: "Phase 4",
      configured:
        hasConfiguredSecret(process.env.CLOUDFLARE_DISPATCH_SECRET) &&
        hasConfiguredSecret(process.env.SUPABASE_SERVICE_ROLE_KEY),
      note: "Playwright crawler worker, visual/text diffing, and Cloudflare + GitHub Actions scheduling implemented; configure secrets to execute live.",
    },
    {
      id: "email",
      label: "Email Alerts",
      provider: "Resend + React Email",
      phase: "Phase 5",
      configured:
        hasConfiguredSecret(process.env.RESEND_API_KEY) &&
        hasConfiguredSecret(process.env.EMAIL_FROM),
      note: "Resend SDK & React Email templates verified for live domain delivery (`email.sidprep.in`).",
    },
    {
      id: "rate-limit",
      label: "API Rate Limiting",
      provider: "Upstash Redis",
      phase: "Phase 6",
      configured: isUpstashRateLimitConfigured(),
      note: "Upstash sliding-window policies protect auth, preview, and crawl endpoints with graceful in-memory fallback.",
    },
  ];
}
