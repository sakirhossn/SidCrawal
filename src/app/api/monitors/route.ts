import { NextResponse } from "next/server";
import { jsonError, parseValidatedJson } from "@/lib/auth/http";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";
import { createMonitorSchema } from "@/lib/monitors/schemas";
import { applyRateLimit } from "@/lib/security/rate-limit";
import { validatePublicTargetWithDns } from "@/lib/security/ssrf";
import { recordApiErrorEvent } from "@/lib/telemetry/api-errors";

export async function GET() {
  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { data, error } = await auth.supabase
    .from("monitors")
    .select(
      "id, name, url, normalized_host, status, check_interval_minutes, last_checked_at, last_changed_at, last_error_code, last_error_message, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("MONITORS_FETCH_FAILED", error.message, 500);
  }

  return NextResponse.json({ monitors: data ?? [] });
}

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, "monitor_write");
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  const validated = await parseValidatedJson(request, createMonitorSchema);
  if ("response" in validated) {
    return validated.response;
  }

  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { supabase, user } = auth;
  const { name, url, checkIntervalMinutes } = validated.data;

  const ssrf = await validatePublicTargetWithDns(url);
  if (!ssrf.ok || !ssrf.normalizedUrl || !ssrf.host) {
    const status = ssrf.code === "SSRF_BLOCKED_TARGET" ? 403 : 400;
    if (status === 403) {
      void recordApiErrorEvent({
        route: "/api/monitors",
        method: "POST",
        statusCode: status,
        errorCode: ssrf.code ?? "SSRF_BLOCKED_TARGET",
        message: ssrf.reason ?? "Blocked target URL on monitor creation.",
        userId: user.id,
      });
    }
    return jsonError(
      ssrf.code ?? "INVALID_URL",
      ssrf.reason ?? "Enter a valid public website URL.",
      status
    );
  }

  // Enforce plan quotas from usage_limits
  const [{ data: limits }, { count: existingCount }] = await Promise.all([
    supabase
      .from("usage_limits")
      .select("max_monitors, min_interval_minutes")
      .eq("user_id", user.id)
      .maybeSingle<{ max_monitors: number; min_interval_minutes: number }>(),
    supabase
      .from("monitors")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const maxMonitors = limits?.max_monitors ?? 5;
  const minInterval = limits?.min_interval_minutes ?? 60;

  if ((existingCount ?? 0) >= maxMonitors) {
    return jsonError(
      "QUOTA_EXCEEDED",
      `Monitor limit reached (${existingCount}/${maxMonitors}). Remove a monitor or upgrade your plan.`,
      429
    );
  }

  if (checkIntervalMinutes < minInterval) {
    return jsonError(
      "INTERVAL_BELOW_PLAN_MINIMUM",
      `Your current plan requires a minimum check interval of ${minInterval} minutes.`,
      400
    );
  }

  const { data: created, error } = await supabase
    .from("monitors")
    .insert({
      user_id: user.id,
      name,
      url: ssrf.normalizedUrl,
      normalized_host: ssrf.host,
      status: "draft",
      check_interval_minutes: checkIntervalMinutes,
    })
    .select(
      "id, name, url, normalized_host, status, check_interval_minutes, last_checked_at, last_changed_at, last_error_code, last_error_message, created_at, updated_at"
    )
    .single();

  if (error || !created) {
    return jsonError(
      "MONITOR_CREATE_FAILED",
      error?.message ?? "Unable to create monitor.",
      500
    );
  }

  return NextResponse.json({ monitor: created }, { status: 201 });
}
