import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { jsonError, requireSupabaseClient } from "@/lib/auth/http";
import { getWorkerEndpoint } from "@/lib/preview/worker-client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface WorkerConcurrencyMetrics {
  activeBrowsers: number;
  queuedRequests: number;
  maxConcurrent: number;
  maxQueueSize: number;
}

export interface WorkerHealthSnapshot {
  configured: boolean;
  endpointLabel: string | null;
  reachable: boolean;
  ok: boolean;
  chromiumAvailable: boolean;
  latencyMs: number | null;
  error: string | null;
  concurrency: WorkerConcurrencyMetrics | null;
}

export interface AdminOperationalMetrics {
  generatedAt: string;
  users: {
    totalRegistered: number;
  };
  monitors: {
    total: number;
    active: number;
    paused: number;
    draft: number;
    error: number;
  };
  crawlJobs: {
    total: number;
    idle: number;
    queued: number;
    running: number;
    backoff: number;
    paused: number;
    backlogDueNow: number;
    staleLockedCount: number;
  };
  crawlRuns: {
    total: number;
    succeeded: number;
    failed: number;
    blocked: number;
    timeout: number;
    recentFailures: Array<{
      id: string;
      monitorId: string;
      status: string;
      errorCode: string | null;
      errorMessage: string | null;
      startedAt: string;
    }>;
  };
  changes: {
    totalDetected: number;
    last24hDetected: number;
  };
  notifications: {
    total: number;
    sent: number;
    failed: number;
    queued: number;
    suppressedDuplicate: number;
    recentFailures: Array<{
      id: string;
      monitorId: string | null;
      notificationType: string;
      recipientEmail: string;
      errorMessage: string | null;
      createdAt: string;
    }>;
  };
  apiErrors: {
    last24hCount: number;
    recent: Array<{
      id: string;
      route: string;
      method: string;
      statusCode: number;
      errorCode: string;
      message: string;
      createdAt: string;
    }>;
  };
  worker: WorkerHealthSnapshot;
}

function sanitizeEndpointLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch {
    return "configured";
  }
}

export async function pingWorkerHealth(): Promise<WorkerHealthSnapshot> {
  const endpoint = getWorkerEndpoint();
  if (!endpoint) {
    return {
      configured: false,
      endpointLabel: null,
      reachable: false,
      ok: false,
      chromiumAvailable: false,
      latencyMs: null,
      error: "BROWSER_WORKER_URL is not configured.",
      concurrency: null,
    };
  }

  const endpointLabel = sanitizeEndpointLabel(endpoint.url);
  const startedAt = performance.now();

  try {
    const res = await fetch(`${endpoint.url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });

    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (!res.ok) {
      return {
        configured: true,
        endpointLabel,
        reachable: true,
        ok: false,
        chromiumAvailable: false,
        latencyMs,
        error: `Worker responded with HTTP ${res.status}`,
        concurrency: null,
      };
    }

    const payload = (await res.json()) as {
      ok?: boolean;
      chromiumAvailable?: boolean;
      concurrency?: Partial<WorkerConcurrencyMetrics>;
    };

    const concurrency =
      payload.concurrency && typeof payload.concurrency === "object"
        ? {
            activeBrowsers: Number(payload.concurrency.activeBrowsers ?? 0),
            queuedRequests: Number(payload.concurrency.queuedRequests ?? 0),
            maxConcurrent: Number(payload.concurrency.maxConcurrent ?? 0),
            maxQueueSize: Number(payload.concurrency.maxQueueSize ?? 0),
          }
        : null;

    return {
      configured: true,
      endpointLabel,
      reachable: true,
      ok: Boolean(payload.ok),
      chromiumAvailable: Boolean(payload.chromiumAvailable),
      latencyMs,
      error: null,
      concurrency,
    };
  } catch (err) {
    return {
      configured: true,
      endpointLabel,
      reachable: false,
      ok: false,
      chromiumAvailable: false,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      error: err instanceof Error ? err.message : "Worker unreachable.",
      concurrency: null,
    };
  }
}

export async function requireAdminSession(): Promise<
  | { user: User; supabaseAdmin: SupabaseClient }
  | { response: NextResponse }
> {
  const clientResult = await requireSupabaseClient();
  if ("response" in clientResult) {
    return clientResult;
  }

  const { supabase } = clientResult;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: jsonError("UNAUTHORIZED", "Sign in to access admin telemetry.", 401),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  if (profileError) {
    return {
      response: jsonError("PROFILE_LOOKUP_FAILED", profileError.message, 500),
    };
  }

  if (profile?.role !== "admin") {
    return {
      response: jsonError(
        "ADMIN_FORBIDDEN",
        "This endpoint requires an administrator role.",
        403
      ),
    };
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      response: jsonError(
        "SUPABASE_ADMIN_UNCONFIGURED",
        "SUPABASE_SERVICE_ROLE_KEY must be configured to query operational telemetry.",
        503
      ),
    };
  }

  return { user, supabaseAdmin };
}

export async function fetchAdminOperationalMetrics(
  supabaseAdmin: SupabaseClient
): Promise<AdminOperationalMetrics> {
  const now = new Date();
  const nowIso = now.toISOString();
  const dayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const staleCutoffIso = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const [
    usersTotalRes,
    monitorsTotalRes,
    monitorsActiveRes,
    monitorsPausedRes,
    monitorsDraftRes,
    monitorsErrorRes,
    jobsTotalRes,
    jobsIdleRes,
    jobsQueuedRes,
    jobsRunningRes,
    jobsBackoffRes,
    jobsPausedRes,
    jobsBacklogDueRes,
    jobsStaleLockedRes,
    runsTotalRes,
    runsSucceededRes,
    runsFailedRes,
    runsBlockedRes,
    runsTimeoutRes,
    recentRunFailuresRes,
    changesTotalRes,
    changesLast24hRes,
    notificationsTotalRes,
    notificationsSentRes,
    notificationsFailedRes,
    notificationsQueuedRes,
    notificationsSuppressedRes,
    recentNotificationFailuresRes,
    apiErrors24hRes,
    recentApiErrorsRes,
    workerHealth,
  ] = await Promise.all([
    supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("monitors").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("monitors")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabaseAdmin
      .from("monitors")
      .select("id", { count: "exact", head: true })
      .eq("status", "paused"),
    supabaseAdmin
      .from("monitors")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft"),
    supabaseAdmin
      .from("monitors")
      .select("id", { count: "exact", head: true })
      .eq("status", "error"),
    supabaseAdmin.from("crawl_jobs").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .eq("state", "idle"),
    supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .eq("state", "queued"),
    supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .eq("state", "running"),
    supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .eq("state", "backoff"),
    supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .eq("state", "paused"),
    supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .in("state", ["idle", "backoff"])
      .lte("next_run_at", nowIso),
    supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .in("state", ["queued", "running"])
      .lt("locked_at", staleCutoffIso),
    supabaseAdmin.from("crawl_runs").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("crawl_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "succeeded"),
    supabaseAdmin
      .from("crawl_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabaseAdmin
      .from("crawl_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "blocked"),
    supabaseAdmin
      .from("crawl_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "timeout"),
    supabaseAdmin
      .from("crawl_runs")
      .select("id, monitor_id, status, error_code, error_message, started_at")
      .in("status", ["failed", "blocked", "timeout"])
      .order("started_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("detected_changes")
      .select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("detected_changes")
      .select("id", { count: "exact", head: true })
      .gte("detected_at", dayAgoIso),
    supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
    supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued"),
    supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "suppressed_duplicate"),
    supabaseAdmin
      .from("notifications")
      .select(
        "id, monitor_id, notification_type, recipient_email, error_message, created_at"
      )
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("api_error_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgoIso),
    supabaseAdmin
      .from("api_error_events")
      .select("id, route, method, status_code, error_code, message, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
    pingWorkerHealth(),
  ]);

  const recentFailuresRaw = (recentRunFailuresRes.data ?? []) as Array<{
    id: string;
    monitor_id: string;
    status: string;
    error_code: string | null;
    error_message: string | null;
    started_at: string;
  }>;

  const recentNotificationFailuresRaw = (recentNotificationFailuresRes.data ??
    []) as Array<{
    id: string;
    monitor_id: string | null;
    notification_type: string;
    recipient_email: string;
    error_message: string | null;
    created_at: string;
  }>;

  const recentApiErrorsRaw = (
    recentApiErrorsRes.error ? [] : (recentApiErrorsRes.data ?? [])
  ) as Array<{
    id: string;
    route: string;
    method: string;
    status_code: number;
    error_code: string;
    message: string;
    created_at: string;
  }>;

  return {
    generatedAt: nowIso,
    users: {
      totalRegistered: usersTotalRes.count ?? 0,
    },
    monitors: {
      total: monitorsTotalRes.count ?? 0,
      active: monitorsActiveRes.count ?? 0,
      paused: monitorsPausedRes.count ?? 0,
      draft: monitorsDraftRes.count ?? 0,
      error: monitorsErrorRes.count ?? 0,
    },
    crawlJobs: {
      total: jobsTotalRes.count ?? 0,
      idle: jobsIdleRes.count ?? 0,
      queued: jobsQueuedRes.count ?? 0,
      running: jobsRunningRes.count ?? 0,
      backoff: jobsBackoffRes.count ?? 0,
      paused: jobsPausedRes.count ?? 0,
      backlogDueNow: jobsBacklogDueRes.count ?? 0,
      staleLockedCount: jobsStaleLockedRes.count ?? 0,
    },
    crawlRuns: {
      total: runsTotalRes.count ?? 0,
      succeeded: runsSucceededRes.count ?? 0,
      failed: runsFailedRes.count ?? 0,
      blocked: runsBlockedRes.count ?? 0,
      timeout: runsTimeoutRes.count ?? 0,
      recentFailures: recentFailuresRaw.map((row) => ({
        id: row.id,
        monitorId: row.monitor_id,
        status: row.status,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        startedAt: row.started_at,
      })),
    },
    changes: {
      totalDetected: changesTotalRes.count ?? 0,
      last24hDetected: changesLast24hRes.count ?? 0,
    },
    notifications: {
      total: notificationsTotalRes.count ?? 0,
      sent: notificationsSentRes.count ?? 0,
      failed: notificationsFailedRes.count ?? 0,
      queued: notificationsQueuedRes.count ?? 0,
      suppressedDuplicate: notificationsSuppressedRes.count ?? 0,
      recentFailures: recentNotificationFailuresRaw.map((row) => ({
        id: row.id,
        monitorId: row.monitor_id,
        notificationType: row.notification_type,
        recipientEmail: row.recipient_email,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      })),
    },
    apiErrors: {
      last24hCount: apiErrors24hRes.error ? 0 : (apiErrors24hRes.count ?? 0),
      recent: recentApiErrorsRaw.map((row) => ({
        id: row.id,
        route: row.route,
        method: row.method,
        statusCode: row.status_code,
        errorCode: row.error_code,
        message: row.message,
        createdAt: row.created_at,
      })),
    },
    worker: workerHealth,
  };
}
