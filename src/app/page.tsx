import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Lock,
  Mail,
  MonitorCheck,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { InteractivePreview } from "@/components/landing/interactive-preview";
import { UrlQuickstart } from "@/components/landing/url-quickstart";
import { IntegrationStatusBadge } from "@/components/site/integration-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { getServerIntegrationStatus } from "@/lib/integration-status";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ARCHITECTURE_PILLARS = [
  {
    icon: MonitorCheck,
    title: "Isolated Chromium rendering—never raw iframes",
    detail:
      "Sites sending X-Frame-Options or CSP frame-ancestors fail inside embedded iframes. SidCrawal renders the target in an isolated Playwright worker and returns sanitized DOM coordinates plus a crisp viewport capture.",
  },
  {
    icon: ShieldCheck,
    title: "Baseline protection & duplicate alert suppression",
    detail:
      "Transient network errors or timeouts never overwrite a valid baseline snapshot. Every change alert is fingerprinted against the latest delivered change so identical diffs never spam your inbox.",
  },
  {
    icon: Mail,
    title: "Visual diff + text comparison in every alert",
    detail:
      "Resend + React Email alerts pair the page title, target URL, detection timestamp, previous screenshot, current screenshot, visual diff, and normalized text delta with a direct link to monitor history.",
  },
];

const SECURITY_CONTROLS = [
  {
    title: "DNS & Redirect SSRF Guard",
    spec: "HTTP/HTTPS only; pre-resolves DNS and validates every redirect hop against RFC1918, loopback, link-local, metadata, and CGNAT IP blocks.",
  },
  {
    title: "Strict Anti-Bypass Compliance",
    spec: "Never circumvents CAPTCHAs, login gates, or paywalls. Blocked targets transition cleanly to a diagnostic blocked state.",
  },
  {
    title: "Tenant Isolation (RLS + Signed URLs)",
    spec: "PostgreSQL Row Level Security isolates every row to auth.uid(); private snapshot artifacts require short-lived signed URLs.",
  },
  {
    title: "Bounded Execution Budgets",
    spec: "Per-run Chromium timeouts, response byte limits, crawl concurrency caps, and per-plan usage quotas protect worker health.",
  },
];

export default function HomePage() {
  const integrations = getServerIntegrationStatus();
  const supabaseReady = isSupabaseConfigured();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-border">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-12 lg:items-center lg:gap-12 lg:px-8">
            <div className="space-y-6 lg:col-span-5">
              <div className="space-y-4">
                <IntegrationStatusBadge configured={supabaseReady} />
                <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-[42px] lg:leading-[1.12]">
                  Monitor the exact pixels and DOM nodes that matter.
                </h1>
                <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
                  SidCrawal renders public websites inside an isolated Playwright browser, lets
                  you target specific elements or visual regions, and sends verified
                  before-and-after screenshot alerts when meaningful content changes.
                </p>
              </div>

              <UrlQuickstart />

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href="/dashboard"
                  className={cn(buttonVariants({ variant: "outline", size: "default" }))}
                >
                  Open Dashboard Shell
                </Link>
                <Link
                  href="/register"
                  className={cn(buttonVariants({ variant: "ghost", size: "default" }))}
                >
                  Create Account
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7">
              <InteractivePreview />
            </div>
          </div>
        </section>

        {/* Architecture & Workflow */}
        <section id="architecture" className="border-b border-border bg-muted/25">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-4">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  Engineered for real-world pages, not fragile HTML diffs.
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Built on Next.js App Router, Supabase PostgreSQL with Row Level Security,
                  Cloudflare Cron dispatch, GitHub Actions Playwright execution, and Resend.
                </p>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border bg-card lg:col-span-8">
                {ARCHITECTURE_PILLARS.map((pillar) => {
                  const Icon = pillar.icon;
                  return (
                    <div
                      key={pillar.title}
                      className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-4"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-emerald-600 dark:text-emerald-400">
                        <Icon className="size-4" aria-hidden="true" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">
                          {pillar.title}
                        </h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {pillar.detail}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Security & Honest Phase 1 Readiness */}
        <section id="security" className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-7">
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    Security boundaries enforced before the first byte loads.
                  </h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Crawling arbitrary public URLs demands strict isolation. Every control is
                    documented in <code className="font-mono text-xs">SECURITY.md</code> and
                    implemented progressively across Phases 2–6.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {SECURITY_CONTROLS.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-xl border border-border bg-card p-4"
                    >
                      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
                        <Lock
                          className="size-3.5 text-emerald-600 dark:text-emerald-400"
                          aria-hidden="true"
                        />
                        <span>{item.title}</span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {item.spec}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 lg:col-span-5">
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-foreground">
                        Phase 1 Integration Readiness
                      </h3>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      live env check
                    </span>
                  </div>

                  <div className="space-y-3">
                    {integrations.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-border/80 bg-background p-3"
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-medium text-foreground">
                            {item.label}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {item.provider}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]",
                            item.configured
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "border-border bg-muted text-muted-foreground"
                          )}
                        >
                          {item.configured ? (
                            <>
                              <CheckCircle2 className="size-3" aria-hidden="true" />
                              Ready
                            </>
                          ) : (
                            <>
                              <Clock className="size-3" aria-hidden="true" />
                              {item.phase}
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-medium text-foreground">SidCrawal</span>
            <span>Phase 1 Foundation Shell</span>
            <span>•</span>
            <span>Theme toggle adapted from Skiper UI &amp; toggles.dev</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              Login
            </Link>
            <Link href="/register" className="hover:text-foreground">
              Register
            </Link>
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/dashboard/workspace" className="hover:text-foreground">
              Selection Workspace
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
