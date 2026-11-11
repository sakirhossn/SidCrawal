import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/metrics";
import { jsonError } from "@/lib/auth/http";
import { applyRateLimit } from "@/lib/security/rate-limit";

const recoverBodySchema = z.object({
  staleMinutes: z.number().int().min(1).max(1440).default(10),
});

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, "monitor_write");
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  const admin = await requireAdminSession();
  if ("response" in admin) {
    return admin.response;
  }

  let staleMinutes = 10;
  const rawText = await request.text();
  if (rawText.trim().length > 0) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      return jsonError("INVALID_JSON", "Invalid JSON payload.", 400);
    }
    const parsed = recoverBodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return jsonError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "staleMinutes must be between 1 and 1440.",
        400
      );
    }
    staleMinutes = parsed.data.staleMinutes;
  }

  const { data, error } = await admin.supabaseAdmin.rpc(
    "recover_stale_crawl_jobs",
    {
      p_stale_minutes: staleMinutes,
    }
  );

  if (error) {
    return jsonError("JOB_RECOVERY_FAILED", error.message, 500);
  }

  const recoveredJobs = Array.isArray(data) ? data : [];
  return NextResponse.json(
    {
      ok: true,
      staleMinutes,
      recoveredCount: recoveredJobs.length,
      recoveredJobs,
    },
    { status: 200, headers: rateLimit.headers }
  );
}
