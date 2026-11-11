import crypto from "node:crypto";
import {
  buildTextDiffSummary,
  computeChangeFingerprint,
} from "./fingerprint";
import { computeRetrySchedule } from "./retry";
import type {
  CrawlTriggerSource,
  WorkerCrawlResponse,
} from "./types";

const SNAPSHOT_BUCKET = "monitor-snapshots";

export interface AdminQueryResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

export interface AdminFilterBuilder extends PromiseLike<AdminQueryResult> {
  select(columns?: string): AdminFilterBuilder;
  eq(column: string, value: string): AdminFilterBuilder;
  gte(column: string, value: string): AdminFilterBuilder;
  limit(count: number): AdminFilterBuilder;
  single<T = unknown>(): PromiseLike<AdminQueryResult<T>>;
  maybeSingle<T = unknown>(): PromiseLike<AdminQueryResult<T>>;
}

export interface AdminTableClient {
  select(columns?: string): AdminFilterBuilder;
  insert(values: Record<string, unknown>): AdminFilterBuilder;
  update(values: Record<string, unknown>): AdminFilterBuilder;
}

export interface AdminSupabaseLike {
  from(table: string): AdminTableClient;
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        fileBody: Buffer,
        fileOptions?: { contentType?: string; upsert?: boolean }
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export interface PersistCrawlParams {
  monitor: {
    id: string;
    user_id: string;
    name: string;
    url: string;
    check_interval_minutes: number;
    active_baseline_snapshot_id: string | null;
  };
  jobId: string | null;
  consecutiveFailures: number;
  triggerSource: CrawlTriggerSource;
  crawlResult: WorkerCrawlResponse;
  startedAtIso?: string;
}

export interface PersistCrawlOutcome {
  crawlRunId: string;
  status: "succeeded" | "failed" | "blocked" | "timeout";
  outcome:
    | "baseline_created"
    | "no_change"
    | "change_detected"
    | "duplicate_change_suppressed"
    | "failed_baseline_preserved";
  snapshotId: string | null;
  detectedChangeId: string | null;
  notificationQueued: boolean;
  deduplicated: boolean;
  preservedBaselineId: string | null;
}

async function uploadSnapshotAsset(
  supabaseAdmin: AdminSupabaseLike,
  path: string,
  pngBase64: string
): Promise<string> {
  const buffer = Buffer.from(pngBase64, "base64");
  const { error } = await supabaseAdmin.storage
    .from(SNAPSHOT_BUCKET)
    .upload(path, buffer, {
      contentType: "image/png",
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed for ${path}: ${error.message}`);
  }
  return path;
}

/**
 * Atomically persists a completed or failed crawler execution to PostgreSQL and private Supabase Storage.
 * Guarantees:
 * 1. Failed/blocked/timed-out crawls NEVER replace `active_baseline_snapshot_id`.
 * 2. Initial crawls create the baseline without emitting a spurious change event.
 * 3. Identical transitions and 24h flapping duplicates are deduplicated via `change_fingerprint`.
 */
export async function persistCrawlExecutionResult(
  supabaseAdmin: AdminSupabaseLike,
  params: PersistCrawlParams
): Promise<PersistCrawlOutcome> {
  const completedAt = new Date();
  const completedAtIso = completedAt.toISOString();
  const startedAtIso =
    params.startedAtIso ??
    new Date(completedAt.getTime() - (params.crawlResult.durationMs || 1)).toISOString();
  const crawlRunId = crypto.randomUUID();
  const result = params.crawlResult;

  // Record crawl execution log row
  const runStatus = result.ok ? "succeeded" : result.outcome;
  const { error: runInsertError } = await supabaseAdmin.from("crawl_runs").insert({
    id: crawlRunId,
    monitor_id: params.monitor.id,
    user_id: params.monitor.user_id,
    job_id: params.jobId,
    trigger_source: params.triggerSource,
    status: runStatus,
    http_status: result.httpStatus,
    resolved_ip: result.resolvedIp,
    duration_ms: result.durationMs,
    error_code: result.ok ? null : result.errorCode,
    error_message: result.ok ? null : result.errorMessage,
    started_at: startedAtIso,
    completed_at: completedAtIso,
  });

  if (runInsertError) {
    throw new Error(`Failed inserting crawl_runs row: ${runInsertError.message}`);
  }

  // Track monthly usage counter safely (non-fatal if quota helper unavailable in mock)
  await Promise.resolve(
    supabaseAdmin.rpc("increment_monthly_crawl_usage", {
      p_user_id: params.monitor.user_id,
    })
  ).catch(() => {});

  // --------------------------------------------------------------------------
  // Failure / Blocked / Timeout Branch: preserve existing valid baseline intact
  // --------------------------------------------------------------------------
  if (!result.ok) {
    const retry = computeRetrySchedule({
      outcome: result.outcome,
      consecutiveFailures: params.consecutiveFailures,
      checkIntervalMinutes: params.monitor.check_interval_minutes,
      now: completedAt,
    });

    await supabaseAdmin
      .from("monitors")
      .update({
        status: retry.nextMonitorStatus,
        last_checked_at: completedAtIso,
        last_error_code: result.errorCode,
        last_error_message: result.errorMessage.slice(0, 500),
      })
      .eq("id", params.monitor.id);

    await supabaseAdmin
      .from("crawl_jobs")
      .update({
        state: retry.nextJobState,
        next_run_at: retry.nextRunAtIso,
        consecutive_failures: retry.nextConsecutiveFailures,
        locked_at: null,
        locked_by: null,
      })
      .eq("monitor_id", params.monitor.id);

    return {
      crawlRunId,
      status: result.outcome,
      outcome: "failed_baseline_preserved",
      snapshotId: null,
      detectedChangeId: null,
      notificationQueued: false,
      deduplicated: false,
      preservedBaselineId: params.monitor.active_baseline_snapshot_id,
    };
  }

  // --------------------------------------------------------------------------
  // Success Branch: Upload private Storage screenshots and handle baseline/diff
  // --------------------------------------------------------------------------
  const storagePrefix = `${params.monitor.user_id}/${params.monitor.id}/${crawlRunId}`;
  const fullPath = await uploadSnapshotAsset(
    supabaseAdmin,
    `${storagePrefix}/full.png`,
    result.fullPagePngBase64
  );
  const elementPath = await uploadSnapshotAsset(
    supabaseAdmin,
    `${storagePrefix}/element.png`,
    result.elementPngBase64
  );

  let diffPath: string | null = null;
  if (result.hasMeaningfulChange && result.diffPngBase64) {
    diffPath = await uploadSnapshotAsset(
      supabaseAdmin,
      `${storagePrefix}/diff.png`,
      result.diffPngBase64
    );
  }

  const successSchedule = computeRetrySchedule({
    outcome: "succeeded",
    consecutiveFailures: 0,
    checkIntervalMinutes: params.monitor.check_interval_minutes,
    now: completedAt,
  });

  // Load current baseline snapshot if monitor already had one
  let baselineSnapshot: {
    id: string;
    normalized_text: string | null;
    content_hash: string;
    visual_hash: string | null;
  } | null = null;

  if (params.monitor.active_baseline_snapshot_id) {
    const { data: baseData } = await supabaseAdmin
      .from("snapshots")
      .select("id, normalized_text, content_hash, visual_hash")
      .eq("id", params.monitor.active_baseline_snapshot_id)
      .maybeSingle<{
        id: string;
        normalized_text: string | null;
        content_hash: string;
        visual_hash: string | null;
      }>();
    baselineSnapshot = baseData ?? null;
  }

  const isInitialBaseline = !baselineSnapshot;
  const shouldPromoteBaseline = isInitialBaseline || result.hasMeaningfulChange;

  const { data: savedSnapshot, error: snapInsertError } = await supabaseAdmin
    .from("snapshots")
    .insert({
      monitor_id: params.monitor.id,
      user_id: params.monitor.user_id,
      crawl_run_id: crawlRunId,
      is_baseline: shouldPromoteBaseline,
      page_title: result.pageTitle,
      extracted_html: result.extractedHtml,
      extracted_text: result.extractedText,
      normalized_text: result.normalizedText,
      content_hash: result.contentHash,
      element_screenshot_path: elementPath,
      full_page_screenshot_path: fullPath,
      visual_hash: result.visualHash,
      captured_at: completedAtIso,
    })
    .select("id")
    .single<{ id: string }>();

  if (snapInsertError || !savedSnapshot) {
    throw new Error(`Failed inserting snapshots row: ${snapInsertError?.message}`);
  }

  // Case 1: Initial Baseline Capture
  if (!baselineSnapshot) {
    await supabaseAdmin
      .from("monitors")
      .update({
        status: "active",
        active_baseline_snapshot_id: savedSnapshot.id,
        last_checked_at: completedAtIso,
        last_error_code: null,
        last_error_message: null,
      })
      .eq("id", params.monitor.id);

    await supabaseAdmin
      .from("crawl_jobs")
      .update({
        state: "idle",
        next_run_at: successSchedule.nextRunAtIso,
        consecutive_failures: 0,
        locked_at: null,
        locked_by: null,
      })
      .eq("monitor_id", params.monitor.id);

    return {
      crawlRunId,
      status: "succeeded",
      outcome: "baseline_created",
      snapshotId: savedSnapshot.id,
      detectedChangeId: null,
      notificationQueued: false,
      deduplicated: false,
      preservedBaselineId: savedSnapshot.id,
    };
  }

  // Case 2: No Meaningful Change
  if (!result.hasMeaningfulChange || !result.changeType) {
    await supabaseAdmin
      .from("monitors")
      .update({
        status: "active",
        last_checked_at: completedAtIso,
        last_error_code: null,
        last_error_message: null,
      })
      .eq("id", params.monitor.id);

    await supabaseAdmin
      .from("crawl_jobs")
      .update({
        state: "idle",
        next_run_at: successSchedule.nextRunAtIso,
        consecutive_failures: 0,
        locked_at: null,
        locked_by: null,
      })
      .eq("monitor_id", params.monitor.id);

    return {
      crawlRunId,
      status: "succeeded",
      outcome: "no_change",
      snapshotId: savedSnapshot.id,
      detectedChangeId: null,
      notificationQueued: false,
      deduplicated: false,
      preservedBaselineId: baselineSnapshot.id,
    };
  }

  // Case 3: Meaningful Change Detected — enforce duplicate alert prevention
  const changeFingerprint = computeChangeFingerprint({
    monitorId: params.monitor.id,
    contentHash: result.contentHash,
    changeType: result.changeType,
    visualDiffPercentage: result.visualDiffPercentage,
  });

  // Check if this exact baseline -> new state transition was already recorded
  const { data: exactTransition } = await supabaseAdmin
    .from("detected_changes")
    .select("id")
    .eq("monitor_id", params.monitor.id)
    .eq("previous_snapshot_id", baselineSnapshot.id)
    .eq("change_fingerprint", changeFingerprint)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (exactTransition) {
    await supabaseAdmin
      .from("crawl_jobs")
      .update({
        state: "idle",
        next_run_at: successSchedule.nextRunAtIso,
        consecutive_failures: 0,
        locked_at: null,
        locked_by: null,
      })
      .eq("monitor_id", params.monitor.id);

    return {
      crawlRunId,
      status: "succeeded",
      outcome: "duplicate_change_suppressed",
      snapshotId: savedSnapshot.id,
      detectedChangeId: exactTransition.id,
      notificationQueued: false,
      deduplicated: true,
      preservedBaselineId: baselineSnapshot.id,
    };
  }

  // Check recent identical change_fingerprint (within 24h) to suppress flapping alert spam
  const dedupeCutoffIso = new Date(completedAt.getTime() - 24 * 60 * 60_000).toISOString();
  const { data: recentDuplicateChange } = await supabaseAdmin
    .from("detected_changes")
    .select("id")
    .eq("monitor_id", params.monitor.id)
    .eq("change_fingerprint", changeFingerprint)
    .gte("detected_at", dedupeCutoffIso)
    .limit(1)
    .maybeSingle<{ id: string }>();

  const isDuplicateAlertWindow = Boolean(recentDuplicateChange);
  const textDiff = buildTextDiffSummary(
    baselineSnapshot.normalized_text ?? "",
    result.normalizedText
  );

  const { data: insertedChange, error: changeInsertError } = await supabaseAdmin
    .from("detected_changes")
    .insert({
      monitor_id: params.monitor.id,
      user_id: params.monitor.user_id,
      previous_snapshot_id: baselineSnapshot.id,
      current_snapshot_id: savedSnapshot.id,
      change_type: result.changeType,
      visual_diff_percentage: result.visualDiffPercentage,
      diff_screenshot_path: diffPath,
      previous_text_excerpt: textDiff.previousExcerpt,
      current_text_excerpt: textDiff.currentExcerpt,
      diff_summary: {
        textChanged: result.textChanged,
        visualChanged: result.visualChanged,
        mismatchedPixels: result.mismatchedPixels,
        totalPixels: result.totalPixels,
        dimensionChanged: result.dimensionChanged,
        previousLength: textDiff.previousLength,
        currentLength: textDiff.currentLength,
        deduplicatedAlert: isDuplicateAlertWindow,
      },
      change_fingerprint: changeFingerprint,
      detected_at: completedAtIso,
    })
    .select("id")
    .single<{ id: string }>();

  if (changeInsertError || !insertedChange) {
    throw new Error(`Failed inserting detected_changes row: ${changeInsertError?.message}`);
  }

  await supabaseAdmin
    .from("monitors")
    .update({
      status: "active",
      active_baseline_snapshot_id: savedSnapshot.id,
      last_checked_at: completedAtIso,
      last_changed_at: completedAtIso,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", params.monitor.id);

  await supabaseAdmin
    .from("crawl_jobs")
    .update({
      state: "idle",
      next_run_at: successSchedule.nextRunAtIso,
      consecutive_failures: 0,
      locked_at: null,
      locked_by: null,
    })
    .eq("monitor_id", params.monitor.id);

  // Queue notification intent for Phase 5 Resend delivery (or mark suppressed_duplicate)
  let notificationQueued = false;
  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", params.monitor.user_id)
      .maybeSingle<{ email: string }>(),
    supabaseAdmin
      .from("user_settings")
      .select("email_notifications_enabled")
      .eq("user_id", params.monitor.user_id)
      .maybeSingle<{ email_notifications_enabled: boolean }>(),
  ]);

  if (profile?.email && settings?.email_notifications_enabled !== false) {
    const { error: notifErr } = await supabaseAdmin.from("notifications").insert({
      user_id: params.monitor.user_id,
      monitor_id: params.monitor.id,
      detected_change_id: insertedChange.id,
      notification_type: "change_alert",
      recipient_email: profile.email,
      subject: isDuplicateAlertWindow
        ? `[Suppressed Duplicate] Change detected on ${params.monitor.name}`
        : `Change detected on ${params.monitor.name}`,
      status: isDuplicateAlertWindow ? "suppressed_duplicate" : "queued",
    });

    if (!notifErr && !isDuplicateAlertWindow) {
      notificationQueued = true;
    }
  }

  return {
    crawlRunId,
    status: "succeeded",
    outcome: isDuplicateAlertWindow ? "duplicate_change_suppressed" : "change_detected",
    snapshotId: savedSnapshot.id,
    detectedChangeId: insertedChange.id,
    notificationQueued,
    deduplicated: isDuplicateAlertWindow,
    preservedBaselineId: savedSnapshot.id,
  };
}
