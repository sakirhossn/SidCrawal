import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseValidatedJson } from "@/lib/auth/http";
import {
  type AdminSupabaseLike,
  persistCrawlExecutionResult,
} from "@/lib/crawler/persist-run";
import type { WorkerCrawlResponse } from "@/lib/crawler/types";
import { processQueuedNotifications } from "@/lib/email/notifications";
import { verifyBearerSecret } from "@/lib/security/internal-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const crawlSuccessSchema = z.object({
  ok: z.literal(true),
  finalUrl: z.string(),
  pageTitle: z.string(),
  httpStatus: z.number().int(),
  resolvedIp: z.string().nullable(),
  durationMs: z.number().int().min(0),
  extractedHtml: z.string(),
  extractedText: z.string(),
  normalizedText: z.string(),
  contentHash: z.string(),
  visualHash: z.string(),
  fullPagePngBase64: z.string(),
  elementPngBase64: z.string(),
  diffPngBase64: z.string().nullable(),
  visualDiffPercentage: z.number(),
  mismatchedPixels: z.number().int(),
  totalPixels: z.number().int(),
  dimensionChanged: z.boolean(),
  textChanged: z.boolean(),
  visualChanged: z.boolean(),
  hasMeaningfulChange: z.boolean(),
  changeType: z.enum(["text", "visual", "both"]).nullable(),
});

const crawlFailureSchema = z.object({
  ok: z.literal(false),
  outcome: z.enum(["failed", "blocked", "timeout"]),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  httpStatus: z.number().int().nullable(),
  resolvedIp: z.string().nullable(),
  durationMs: z.number().int().min(0),
});

const crawlResultCallbackSchema = z.object({
  monitorId: z.string().uuid(),
  jobId: z.string().uuid().nullable().default(null),
  triggerSource: z.enum(["baseline", "scheduled", "manual"]).default("scheduled"),
  startedAtIso: z.string().optional(),
  crawlResult: z.discriminatedUnion("ok", [crawlSuccessSchema, crawlFailureSchema]),
});

export async function POST(request: Request) {
  if (
    !verifyBearerSecret(
      request.headers.get("authorization"),
      process.env.BROWSER_WORKER_SECRET
    )
  ) {
    return jsonError(
      "UNAUTHORIZED_WORKER",
      "Invalid or missing worker authorization secret.",
      401
    );
  }

  const parsed = await parseValidatedJson(request, crawlResultCallbackSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return jsonError(
      "SUPABASE_ADMIN_UNCONFIGURED",
      "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required.",
      503
    );
  }

  const { monitorId, jobId, triggerSource, startedAtIso, crawlResult } = parsed.data;

  const [{ data: monitor, error: monitorErr }, { data: job }] = await Promise.all([
    supabaseAdmin
      .from("monitors")
      .select(
        "id, user_id, name, url, check_interval_minutes, active_baseline_snapshot_id"
      )
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
      .from("crawl_jobs")
      .select("id, consecutive_failures")
      .eq("monitor_id", monitorId)
      .maybeSingle<{ id: string; consecutive_failures: number }>(),
  ]);

  if (monitorErr) {
    return jsonError("MONITOR_LOOKUP_FAILED", monitorErr.message, 500);
  }
  if (!monitor) {
    return jsonError("MONITOR_NOT_FOUND", "Target monitor not found.", 404);
  }

  const persisted = await persistCrawlExecutionResult(
    supabaseAdmin as unknown as AdminSupabaseLike,
    {
      monitor,
      jobId: jobId ?? job?.id ?? null,
      consecutiveFailures: job?.consecutive_failures ?? 0,
      triggerSource,
      crawlResult: crawlResult as WorkerCrawlResponse,
      startedAtIso,
    }
  );

  if (persisted.notificationQueued && persisted.detectedChangeId) {
    await processQueuedNotifications(supabaseAdmin, {
      detectedChangeId: persisted.detectedChangeId,
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, result: persisted }, { status: 200 });
}
