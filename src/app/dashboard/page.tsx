import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Crosshair,
  Plus,
} from "lucide-react";
import { PhaseShellNotice } from "@/components/dashboard/phase-shell-notice";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentAccountContext } from "@/lib/auth/session";
import { getServerIntegrationStatus } from "@/lib/integration-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
};

interface MonitorSummaryRow {
  id: string;
  name: string;
  url: string;
  status: string;
  check_interval_minutes: number;
}

async function DashboardOverviewContent() {
  const [account, integrations] = await Promise.all([
    getCurrentAccountContext(),
    Promise.resolve(getServerIntegrationStatus()),
  ]);

  let monitors: MonitorSummaryRow[] = [];
  if (account.configured && account.user) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data } = await supabase
        .from("monitors")
        .select("id, name, url, status, check_interval_minutes")
        .order("created_at", { ascending: false })
        .limit(10);
      monitors = (data ?? []) as MonitorSummaryRow[];
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {account.profile?.full_name
              ? `Welcome back, ${account.profile.full_name}`
              : "Monitoring Overview"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage targeted webpage monitors, baseline snapshots, and verified change alerts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dashboard/workspace"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Crosshair className="size-3.5" aria-hidden="true" />
            <span>Selection Workspace</span>
          </Link>
          <Link
            href="/dashboard/monitors/new"
            className={cn(buttonVariants({ variant: "default", size: "sm" }))}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>Add Monitor</span>
          </Link>
        </div>
      </div>

      {!account.configured ? (
        <PhaseShellNotice
          phase="Phase 2 Ready"
          title="Connect Supabase credentials to activate authentication & RLS"
          description="Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and apply supabase/migrations/ to enable user accounts, profile sync, and dashboard protection."
          actionHref="/login"
          actionLabel="View login flow"
        />
      ) : (
        <PhaseShellNotice
          phase="Phase 2 Active"
          title={`Signed in as ${account.profile?.email ?? account.user?.email ?? "verified user"}`}
          description={`Plan: ${account.usageLimits?.plan_tier ?? "free"} • ${monitors.length} / ${account.usageLimits?.max_monitors ?? 5} monitors used. Playwright selection & scheduled crawls connect in Phases 3–4.`}
          actionHref="/dashboard/settings"
          actionLabel="Manage settings"
        />
      )}

      {/* Monitored Targets */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Monitored Targets</CardTitle>
              <CardDescription>
                {monitors.length} persisted monitor{monitors.length === 1 ? "" : "s"} •
                Playwright selection &amp; baseline captures connect in Phases 3–4.
              </CardDescription>
            </div>
            <Link
              href="/dashboard/monitors/sample-monitor"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>Inspect detail layout</span>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {monitors.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
              <div className="mx-auto max-w-md space-y-2">
                <p className="text-sm font-medium text-foreground">
                  No persisted monitors yet
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Test URL pre-validation in Add Monitor or preview the dual-pane
                  Selection Workspace before Phase 3 Playwright rendering connects.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <Link
                    href="/dashboard/monitors/new"
                    className={cn(buttonVariants({ variant: "default", size: "sm" }))}
                  >
                    Test URL Validator
                  </Link>
                  <Link
                    href="/dashboard/workspace"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Open Workspace Shell
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {monitors.map((monitor) => (
                <div
                  key={monitor.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-sm"
                >
                  <div className="min-w-0 space-y-0.5">
                    <Link
                      href={`/dashboard/monitors/${monitor.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {monitor.name}
                    </Link>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {monitor.url}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
                    <span>every {monitor.check_interval_minutes}m</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-foreground">
                      {monitor.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Environment Readiness */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>Platform Integration Readiness</CardTitle>
          <CardDescription>
            Checked live on the server without exposing secret values.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
          {integrations.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background p-3.5"
            >
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.provider}</div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {item.note}
                </p>
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
                    Configured
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
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardOverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <DashboardOverviewContent />
    </Suspense>
  );
}
