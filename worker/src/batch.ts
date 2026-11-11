import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type AdminSupabaseLike,
  persistCrawlExecutionResult,
} from "../../src/lib/crawler/persist-run.js";
import type { CrawlJobDispatchItem } from "../../src/lib/crawler/types.js";
import { executeMonitorCrawl } from "./crawler.js";

const SNAPSHOT_BUCKET = "monitor-snapshots";

function requireSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for batch crawling."
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function downloadBaselineScreenshotBase64(
  supabaseAdmin: SupabaseClient,
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(SNAPSHOT_BUCKET)
    .download(path);
  if (error || !data) {
    return null;
  }
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf).toString("base64");
}

async function fetchSingleJob(
  supabaseAdmin: SupabaseClient,
  monitorId: string
): Promise<CrawlJobDispatchItem[]> {
  const [{ data: monitor }, { data: selection }, { data: job }] = await Promise.all([
    supabaseAdmin
      .from("monitors")
      .select("id, user_id, name, url, check_interval_minutes, active_baseline_snapshot_id")
      .eq("id", monitorId)
      .maybeSingle<{
        id: string;
        user_id: string;
        name: string;
        url: string;
        check_interval_minutes: number;
        active_baseline_snapshot_id: string | null;
      }>(),
    supabaseAdmin
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
    supabaseAdmin
      .from("crawl_jobs")
      .select("id, state, locked_at, consecutive_failures")
      .eq("monitor_id", monitorId)
      .maybeSingle<{
        id: string;
        state: string;
        locked_at: string | null;
        consecutive_failures: number;
      }>(),
  ]);

  if (!monitor || !selection) {
    return [];
  }

  // Prevent duplicate execution if job is actively running/queued within lock window
  if (
    job &&
    (job.state === "running" || job.state === "queued") &&
    job.locked_at &&
    Date.now() - new Date(job.locked_at).getTime() < 10 * 60_000
  ) {
    return [];
  }

  return [
    {
      job_id: job?.id ?? "",
      monitor_id: monitor.id,
      user_id: monitor.user_id,
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
    },
  ];
}

export async function runScheduledCrawlBatch(options?: {
  limit?: number;
  monitorId?: string;
  workerId?: string;
  concurrency?: number;
}) {
  const supabaseAdmin = requireSupabaseAdmin();
  const envConcurrency = Number(process.env.CRAWL_CONCURRENCY ?? "2");
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const workerId = options?.workerId ?? `worker-${process.pid}`;
  const concurrency = Math.min(
    Math.max(options?.concurrency ?? (Number.isFinite(envConcurrency) ? envConcurrency : 2), 1),
    4
  );

  let jobs: CrawlJobDispatchItem[] = [];
  if (options?.monitorId) {
    jobs = await fetchSingleJob(supabaseAdmin, options.monitorId);
  } else {
    const { data, error } = await supabaseAdmin.rpc("claim_due_crawl_jobs", {
      p_limit: limit,
      p_worker_id: workerId,
    });
    if (error) {
      throw new Error(`Failed claiming due crawl jobs: ${error.message}`);
    }
    jobs = (data ?? []) as CrawlJobDispatchItem[];
  }

  const summaries: Array<{
    monitorId: string;
    outcome: string;
    crawlRunId: string;
    detectedChangeId: string | null;
  }> = [];

  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (job) => {
        if (job.job_id) {
          await supabaseAdmin
            .from("crawl_jobs")
            .update({
              state: "running",
              locked_at: new Date().toISOString(),
              locked_by: workerId,
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
            const elementScreenshotBase64 = await downloadBaselineScreenshotBase64(
              supabaseAdmin,
              snap.element_screenshot_path
            );
            previousBaseline = {
              snapshotId: snap.id,
              normalizedText: snap.normalized_text ?? "",
              contentHash: snap.content_hash,
              visualHash: snap.visual_hash,
              elementScreenshotBase64,
            };
          }
        }

        const startedAtIso = new Date().toISOString();
        const crawlResult = await executeMonitorCrawl({
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
        });

        return {
          monitorId: job.monitor_id,
          outcome: persisted.outcome,
          crawlRunId: persisted.crawlRunId,
          detectedChangeId: persisted.detectedChangeId,
        };
      })
    );

    summaries.push(...chunkResults);
  }

  // Trigger Next.js notification drainer for newly queued change alerts (when configured)
  const hasNewChanges = summaries.some(
    (s) => s.outcome === "change_detected" && s.detectedChangeId
  );
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const dispatchSecret = process.env.CLOUDFLARE_DISPATCH_SECRET?.trim();
  if (hasNewChanges && appUrl && dispatchSecret) {
    await fetch(`${appUrl}/api/internal/send-notifications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dispatchSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 25 }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }

  return {
    claimed: jobs.length,
    processed: summaries.length,
    results: summaries,
  };
}

// Allow CLI execution in GitHub Actions or local terminal
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("batch.ts")
) {
  const monitorId = process.env.TARGET_MONITOR_ID?.trim() || undefined;
  const limit = Number(process.env.CRAWL_BATCH_LIMIT ?? "10");
  const workerId =
    process.env.GITHUB_RUN_ID
      ? `gh-run-${process.env.GITHUB_RUN_ID}`
      : `cli-${process.pid}`;

  runScheduledCrawlBatch({ limit, monitorId, workerId })
    .then((summary) => {
      console.log(JSON.stringify({ ok: true, ...summary }));
      process.exit(0);
    })
    .catch((err) => {
      console.error(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      process.exit(1);
    });
}
