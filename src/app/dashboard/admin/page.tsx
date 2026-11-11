import { Suspense } from "react";
import { connection } from "next/server";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  MailWarning,
  ServerCrash,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { AdminRecoverButton } from "@/components/dashboard/admin-recover-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchAdminOperationalMetrics,
  pingWorkerHealth,
  type AdminOperationalMetrics,
} from "@/lib/admin/metrics";
import { getCurrentAccountContext } from "@/lib/auth/session";
import { getServerIntegrationStatus } from "@/lib/integration-status";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function formatUtcTimestamp(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return iso;
  }
}

function WorkerStatusBadge({
  ok,
  reachable,
  configured,
}: {
  ok: boolean;
  reachable: boolean;
  configured: boolean;
}) {
  if (!configured) {
    return <Badge variant="outline">Unconfigured</Badge>;
  }
  if (!reachable) {
    return <Badge variant="destructive">Unreachable</Badge>;
  }
  if (!ok) {
    return <Badge variant="destructive">Degraded</Badge>;
  }
  return <Badge variant="secondary">Healthy</Badge>;
}

async function AdminDashboardContent() {
  await connection();
  const account = await getCurrentAccountContext();

  if (account.configured && account.profile?.role !== "admin") {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Platform telemetry and worker operations require administrator access.
          </p>
        </div>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-destructive" />
              403 — Admin Role Required
            </CardTitle>
            <CardDescription>
              Signed in as {account.user?.email ?? "standard user"} (role:{" "}
              {account.profile?.role ?? "user"}). Promote{" "}
              <code className="font-mono text-xs">profiles.role</code> to{" "}
              <code className="font-mono text-xs">admin</code> in Supabase to inspect
              platform operational metrics.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const supabaseAdmin = account.configured ? createSupabaseAdminClient() : null;
  const integrations = getServerIntegrationStatus();

  const metrics: AdminOperationalMetrics | null =
    account.configured && supabaseAdmin
      ? await fetchAdminOperationalMetrics(supabaseAdmin)
      : null;

  const fallbackWorker = metrics ? metrics.worker : await pingWorkerHealth();
  const failedRunsCount = metrics
    ? metrics.crawlRuns.failed +
      metrics.crawlRuns.blocked +
      metrics.crawlRuns.timeout
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Admin Operations Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Live PostgreSQL telemetry, queue depth, worker health, email delivery, and API error logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <WorkerStatusBadge
            configured={fallbackWorker.configured}
            reachable={fallbackWorker.reachable}
            ok={fallbackWorker.ok}
          />
          {metrics ? (
            <Badge variant="outline" className="font-mono text-xs">
              Synced {formatUtcTimestamp(metrics.generatedAt)}
            </Badge>
          ) : (
            <Badge variant="outline">Awaiting Database Connection</Badge>
          )}
        </div>
      </div>

      {!metrics ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Database credentials not yet connected in this environment</AlertTitle>
          <AlertDescription>
            Configure real Supabase URL, Anon Key, and{" "}
            <code className="font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
            <code className="font-mono text-xs">.env.local</code> (and run SQL migrations{" "}
            <code className="font-mono text-xs">0001</code> through{" "}
            <code className="font-mono text-xs">0005</code>) to stream platform counts.
            Zero synthetic or mocked numbers are displayed.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Core 9 Operational Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Total Registered Users</span>
              <Users className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics ? metrics.users.totalRegistered : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? "Verified and onboarding profiles in public.profiles."
              : "Connect Supabase to query registered profiles."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Active Monitors</span>
              <Eye className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics ? metrics.monitors.active : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? `${metrics.monitors.total} total (${metrics.monitors.paused} paused, ${metrics.monitors.draft} draft, ${metrics.monitors.error} error)`
              : "Connect Supabase to inspect monitor states."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Total Crawl Jobs</span>
              <Activity className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics ? metrics.crawlJobs.total : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? `${metrics.crawlJobs.running} running · ${metrics.crawlJobs.queued} queued · ${metrics.crawlJobs.idle} idle · ${metrics.crawlJobs.backoff} backoff`
              : "Connect Supabase to inspect scheduler job rows."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Successful &amp; Failed Crawls</span>
              <CheckCircle2 className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics ? `${metrics.crawlRuns.succeeded} / ${failedRunsCount}` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? `${metrics.crawlRuns.total} total runs (${metrics.crawlRuns.failed} failed, ${metrics.crawlRuns.blocked} blocked, ${metrics.crawlRuns.timeout} timeout)`
              : "Connect Supabase to query public.crawl_runs."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Changes Detected</span>
              <Sparkles className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics ? metrics.changes.totalDetected : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? `${metrics.changes.last24hDetected} meaningful change event(s) in the last 24 hours.`
              : "Connect Supabase to inspect public.detected_changes."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Emails Sent &amp; Failed</span>
              <Bell className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics
                ? `${metrics.notifications.sent} / ${metrics.notifications.failed}`
                : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? `${metrics.notifications.queued} queued · ${metrics.notifications.suppressedDuplicate} duplicate alerts suppressed`
              : "Resend live domain active; connect DB for persistent ledger counts."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Queue Backlog</span>
              <Clock className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics ? metrics.crawlJobs.backlogDueNow : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? `${metrics.crawlJobs.staleLockedCount} stale worker lock(s) > 10m`
              : "Due idle/backoff crawl jobs waiting for dispatch."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>Worker Status</span>
              <Cpu className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-xl">
              {fallbackWorker.reachable
                ? fallbackWorker.ok
                  ? "Online"
                  : "Degraded"
                : fallbackWorker.configured
                  ? "Offline"
                  : "Unconfigured"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {fallbackWorker.reachable ? (
              <span>
                Chromium: {fallbackWorker.chromiumAvailable ? "Ready" : "Missing"} ·{" "}
                {fallbackWorker.latencyMs ?? 0}ms
                {fallbackWorker.concurrency
                  ? ` · Slots ${fallbackWorker.concurrency.activeBrowsers}/${fallbackWorker.concurrency.maxConcurrent} (queued ${fallbackWorker.concurrency.queuedRequests})`
                  : ""}
              </span>
            ) : (
              <span>{fallbackWorker.error ?? "Start local worker via npm run worker:dev."}</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>API Errors (24h)</span>
              <ServerCrash className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {metrics ? metrics.apiErrors.last24hCount : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {metrics
              ? `${metrics.apiErrors.recent.length} recent rate-limit, SSRF, or worker error events logged.`
              : "Connect Supabase + migration 0005 to capture api_error_events."}
          </CardContent>
        </Card>
      </div>

      {/* Queue Recovery Controls + Environment Integration Readiness */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Queue Recovery &amp; Concurrency</CardTitle>
            <CardDescription>
              Stale jobs locked longer than 10 minutes are automatically reclaimed on dispatch or via manual admin trigger without ever overwriting baselines.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AdminRecoverButton
              staleLockedCount={metrics?.crawlJobs.staleLockedCount ?? 0}
              disabled={!metrics}
            />
            <Separator />
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Worker Origin</p>
                <p className="font-mono font-medium">
                  {fallbackWorker.endpointLabel ?? "Not set"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Browser Capacity</p>
                <p className="font-medium">
                  {fallbackWorker.concurrency
                    ? `${fallbackWorker.concurrency.maxConcurrent} concurrent / ${fallbackWorker.concurrency.maxQueueSize} queued (${fallbackWorker.concurrency.activeBrowsers} active)`
                    : "Ping worker /health to inspect live limiter"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Environment Integrations</CardTitle>
            <CardDescription>
              Safe boolean readiness checks from server runtime variables (no secrets exposed).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {integrations.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="truncate text-muted-foreground">{item.provider}</p>
                </div>
                <Badge variant={item.configured ? "secondary" : "outline"}>
                  {item.configured ? "Configured" : "Pending"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Detailed Failure & API Error Tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ServerCrash className="size-4 text-muted-foreground" />
              Recent Crawl Failures
            </CardTitle>
            <CardDescription>
              Latest blocked, timed-out, or failed worker runs (baselines preserved).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics && metrics.crawlRuns.recentFailures.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.crawlRuns.recentFailures.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Badge variant="destructive">{run.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {run.errorCode ?? "ERR"}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                        {run.errorMessage ?? "No diagnostic detail"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatUtcTimestamp(run.startedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                {metrics
                  ? "Zero crawl run failures recorded."
                  : "Connect Supabase to view crawl failure history."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MailWarning className="size-4 text-muted-foreground" />
              Failed Email Deliveries
            </CardTitle>
            <CardDescription>
              Resend delivery errors logged from change alerts or account notices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics && metrics.notifications.recentFailures.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.notifications.recentFailures.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">
                        {item.notificationType}
                      </TableCell>
                      <TableCell className="text-xs">{item.recipientEmail}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-destructive">
                        {item.errorMessage ?? "Delivery failed"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                {metrics
                  ? "Zero failed notification rows recorded."
                  : "Connect Supabase to inspect persistent notification failures."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent API &amp; Security Events</CardTitle>
          <CardDescription>
            Rate-limit rejections (429), SSRF URL blocks (403), and worker/API errors stored in public.api_error_events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {metrics && metrics.apiErrors.recent.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.apiErrors.recent.map((evt) => (
                  <TableRow key={evt.id}>
                    <TableCell className="font-mono text-xs">
                      {evt.method} {evt.route}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={evt.statusCode >= 500 ? "destructive" : "outline"}
                      >
                        {evt.statusCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{evt.errorCode}</TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                      {evt.message}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatUtcTimestamp(evt.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              {metrics
                ? "Zero API error events recorded."
                : "Connect Supabase and run migration 0005 to track live API errors."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <AdminDashboardContent />
    </Suspense>
  );
}
