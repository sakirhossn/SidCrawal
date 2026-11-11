import type { SupabaseClient } from "@supabase/supabase-js";
import { processQueuedNotifications } from "@/lib/email/notifications";
import { requestWorkerCrawl, WorkerClientError } from "@/lib/preview/worker-client";
import {
  type AdminSupabaseLike,
  persistCrawlExecutionResult,
  type PersistCrawlOutcome,
} from "./persist-run";
import type { CrawlJobDispatchItem, WorkerCrawlResponse } from "./types";

const SNAPSHOT_BUCKET = "monitor-snapshots";

export async function executeAndPersistMonitorCrawl(
  supabaseAdmin: SupabaseClient,
  job: CrawlJobDispatchItem
): Promise<{ crawlResult: WorkerCrawlResponse; persisted: PersistCrawlOutcome }> {
  const startedAtIso = new Date().toISOString();

  if (job.job_id) {
    await supabaseAdmin
      .from("crawl_jobs")
      .update({
        state: "running",
        locked_at: startedAtIso,
        locked_by: "web-dispatcher",
      })
      .eq("id", job.job_id);
  }

  let previousBaseline = null;
  if (job.active_baseline_snapshot_id) {
    const { data: snap } = await supabaseAdmin
      .from("snapshots")
      .select("id, normalized_text, content_hash, visual_hash, element_screenshot_path")
      .eq("id", job.active_baseline_snapshot_id)
      .maybeSingle<{
        id: string;
        normalized_text: string | null;
        content_hash: string;
        visual_hash: string | null;
        element_screenshot_path: string | null;
      }>();

    if (snap) {
      let elementScreenshotBase64: string | null = null;
      if (snap.element_screenshot_path) {
        const { data: fileBlob } = await supabaseAdmin.storage
          .from(SNAPSHOT_BUCKET)
          .download(snap.element_screenshot_path);
        if (fileBlob) {
          elementScreenshotBase64 = Buffer.from(
            await fileBlob.arrayBuffer()
          ).toString("base64");
        }
      }
      previousBaseline = {
        snapshotId: snap.id,
        normalizedText: snap.normalized_text ?? "",
        contentHash: snap.content_hash,
        visualHash: snap.visual_hash,
        elementScreenshotBase64,
      };
    }
  }

  let crawlResult: WorkerCrawlResponse;
  try {
    crawlResult = await requestWorkerCrawl({
      url: job.url,
      selectionType: job.selection_type,
      cssSelector: job.css_selector,
      selectors: Array.isArray(job.selectors_json) ? job.selectors_json : [],
      boundingBox: job.bounding_box,
      viewport: job.viewport_dimensions ?? {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
      },
      normalizationRules: job.normalization_rules ?? {},
      previousBaseline,
    });
  } catch (err) {
    const isClientErr = err instanceof WorkerClientError;
    const code = isClientErr ? err.code : "WORKER_EXECUTION_ERROR";
    const message =
      err instanceof Error ? err.message : "Failed calling crawler worker.";
    crawlResult = {
      ok: false,
      outcome: code === "WORKER_TIMEOUT" ? "timeout" : "failed",
      errorCode: code,
      errorMessage: message,
      httpStatus: isClientErr ? err.statusCode : null,
      resolvedIp: null,
      durationMs: 1,
    };
  }

  const persisted = await persistCrawlExecutionResult(
    supabaseAdmin as unknown as AdminSupabaseLike,
    {
      monitor: {
        id: job.monitor_id,
        user_id: job.user_id,
        name: job.monitor_name,
        url: job.url,
        check_interval_minutes: job.check_interval_minutes,
        active_baseline_snapshot_id: job.active_baseline_snapshot_id,
      },
      jobId: job.job_id || null,
      consecutiveFailures: job.consecutive_failures,
      triggerSource: job.trigger_source,
      crawlResult,
      startedAtIso,
    }
  );

  if (persisted.notificationQueued && persisted.detectedChangeId) {
    await processQueuedNotifications(supabaseAdmin, {
      detectedChangeId: persisted.detectedChangeId,
    }).catch(() => null);
  }

  return { crawlResult, persisted };
}
