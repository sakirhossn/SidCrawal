import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth/http";
import { executeAndPersistMonitorCrawl } from "@/lib/crawler/run-monitor-crawl";
import type { CrawlJobDispatchItem } from "@/lib/crawler/types";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";
import { applyRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordApiErrorEvent } from "@/lib/telemetry/api-errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateLimit = await applyRateLimit(request, "monitor_crawl");
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  const { id: monitorId } = await context.params;
  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return jsonError(
      "SUPABASE_ADMIN_UNCONFIGURED",
      "SUPABASE_SERVICE_ROLE_KEY must be configured on the server to store crawl snapshots and diffs.",
      503
    );
  }

  const { supabase, user } = auth;

  // Enforce ownership under the authenticated user's RLS session first
  const [{ data: monitor, error: monitorErr }, { data: selection }, { data: limits }] =
    await Promise.all([
      supabase
        .from("monitors")
        .select(
          "id, user_id, name, url, status, check_interval_minutes, active_baseline_snapshot_id"
        )
        .eq("id", monitorId)
        .maybeSingle<{
          id: string;
          user_id: string;
          name: string;
          url: string;
          status: string;
          check_interval_minutes: number;
          active_baseline_snapshot_id: string | null;
        }>(),
      supabase
        .from("monitor_selections")
        .select(
          "id, selection_type, css_selector, selectors_json, bounding_box, viewport_dimensions, normalization_rules"
        )
        .eq("monitor_id", monitorId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
          id: string;
          selection_type: CrawlJobDispatchItem["selection_type"];
          css_selector: string | null;
          selectors_json: string[];
          bounding_box: CrawlJobDispatchItem["bounding_box"];
          viewport_dimensions: CrawlJobDispatchItem["viewport_dimensions"];
          normalization_rules: CrawlJobDispatchItem["normalization_rules"];
        }>(),
      supabase
        .from("usage_limits")
        .select(
          "max_monthly_crawls, current_month_crawls, quota_reset_at, max_concurrent_jobs"
        )
        .eq("user_id", user.id)
        .maybeSingle<{
          max_monthly_crawls: number;
          current_month_crawls: number;
          quota_reset_at: string;
          max_concurrent_jobs?: number;
        }>(),
    ]);

  if (monitorErr) {
    return jsonError("MONITOR_LOOKUP_FAILED", monitorErr.message, 500);
  }
  if (!monitor) {
    return jsonError("MONITOR_NOT_FOUND", "Monitor not found.", 404);
  }
  if (!selection) {
    return jsonError(
      "NO_SELECTION_CONFIGURED",
      "Select an HTML element or visual region before running a crawl.",
      400
    );
  }

  if (limits) {
    const quotaResetAt = new Date(limits.quota_reset_at).getTime();
    if (
      quotaResetAt > Date.now() &&
      limits.current_month_crawls >= limits.max_monthly_crawls
    ) {
      return jsonError(
        "CRAWL_QUOTA_EXCEEDED",
        `Monthly crawl limit (${limits.max_monthly_crawls}) reached for your current plan.`,
        429
      );
    }
  }

  const { data: job } = await supabase
    .from("crawl_jobs")
    .select("id, state, consecutive_failures")
    .eq("monitor_id", monitor.id)
    .maybeSingle<{
      id: string;
      state: string;
      consecutive_failures: number;
    }>();

  if (job?.state === "running" || job?.state === "queued") {
    return jsonError(
      "CRAWL_ALREADY_RUNNING",
      "A crawl for this monitor is already queued or running. Try again shortly.",
      409
    );
  }

  const maxConcurrentJobs = limits?.max_concurrent_jobs ?? 2;
  if (typeof supabaseAdmin.from === "function") {
    const { count: activeUserJobs } = await supabaseAdmin
      .from("crawl_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("state", ["queued", "running"]);

    if (
      typeof activeUserJobs === "number" &&
      activeUserJobs >= maxConcurrentJobs
    ) {
      void recordApiErrorEvent({
        route: "/api/monitors/[id]/crawl",
        method: "POST",
        statusCode: 429,
        errorCode: "CONCURRENT_CRAWL_LIMIT_REACHED",
        message: `User reached concurrent crawl limit (${activeUserJobs}/${maxConcurrentJobs}).`,
        userId: user.id,
      });
      return jsonError(
        "CONCURRENT_CRAWL_LIMIT_REACHED",
        `Maximum concurrent crawls (${maxConcurrentJobs}) already running for your account. Wait for one to finish.`,
        429
      );
    }
  }

  const dispatchItem: CrawlJobDispatchItem = {
    job_id: job?.id ?? "",
    monitor_id: monitor.id,
    user_id: user.id,
    url: monitor.url,
    monitor_name: monitor.name,
    check_interval_minutes: monitor.check_interval_minutes,
    consecutive_failures: job?.consecutive_failures ?? 0,
    active_baseline_snapshot_id: monitor.active_baseline_snapshot_id,
    trigger_source: monitor.active_baseline_snapshot_id ? "manual" : "baseline",
    selection_id: selection.id,
    selection_type: selection.selection_type,
    css_selector: selection.css_selector,
    selectors_json: Array.isArray(selection.selectors_json)
      ? selection.selectors_json
      : [],
    bounding_box: selection.bounding_box,
    viewport_dimensions: selection.viewport_dimensions ?? {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    },
    normalization_rules: selection.normalization_rules ?? {},
  };

  const { crawlResult, persisted } = await executeAndPersistMonitorCrawl(
    supabaseAdmin,
    dispatchItem
  );

  return NextResponse.json(
    {
      ok: crawlResult.ok,
      persistence: persisted,
      error: crawlResult.ok
        ? null
        : {
            code: crawlResult.errorCode,
            message: crawlResult.errorMessage,
          },
    },
    { status: 200, headers: rateLimit.headers }
  );
}
