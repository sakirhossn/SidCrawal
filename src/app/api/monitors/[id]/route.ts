import { NextResponse } from "next/server";
import { jsonError, parseValidatedJson } from "@/lib/auth/http";
import { sendMonitorActivationNotification } from "@/lib/email/notifications";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";
import { updateMonitorSchema } from "@/lib/monitors/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { supabase } = auth;
  const [{ data: monitor, error }, { data: selection }] = await Promise.all([
    supabase
      .from("monitors")
      .select(
        "id, name, url, normalized_host, status, check_interval_minutes, last_checked_at, last_changed_at, last_error_code, last_error_message, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("monitor_selections")
      .select(
        "id, monitor_id, selection_type, css_selector, selectors_json, element_metadata, bounding_box, viewport_dimensions, selected_text, normalization_rules, is_active, created_at, updated_at"
      )
      .eq("monitor_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (error) {
    return jsonError("MONITOR_FETCH_FAILED", error.message, 500);
  }
  if (!monitor) {
    return jsonError("MONITOR_NOT_FOUND", "Monitor not found.", 404);
  }

  return NextResponse.json({
    monitor,
    selection: selection ?? null,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const validated = await parseValidatedJson(request, updateMonitorSchema);
  if ("response" in validated) {
    return validated.response;
  }

  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { supabase, user } = auth;

  if (validated.data.checkIntervalMinutes !== undefined) {
    const { data: limits } = await supabase
      .from("usage_limits")
      .select("min_interval_minutes")
      .eq("user_id", user.id)
      .maybeSingle<{ min_interval_minutes: number }>();

    const minInterval = limits?.min_interval_minutes ?? 60;
    if (validated.data.checkIntervalMinutes < minInterval) {
      return jsonError(
        "INTERVAL_BELOW_PLAN_MINIMUM",
        `Your current plan requires a minimum check interval of ${minInterval} minutes.`,
        400
      );
    }
  }

  if (validated.data.status === "active") {
    const { count } = await supabase
      .from("monitor_selections")
      .select("id", { count: "exact", head: true })
      .eq("monitor_id", id)
      .eq("is_active", true);

    if (!count || count < 1) {
      return jsonError(
        "SELECTION_REQUIRED",
        "Save an element or region selection in the Workspace before activating this monitor.",
        400
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (validated.data.name !== undefined) updates.name = validated.data.name;
  if (validated.data.status !== undefined) updates.status = validated.data.status;
  if (validated.data.checkIntervalMinutes !== undefined) {
    updates.check_interval_minutes = validated.data.checkIntervalMinutes;
  }

  const { data: updated, error } = await supabase
    .from("monitors")
    .update(updates)
    .eq("id", id)
    .select(
      "id, name, url, normalized_host, status, check_interval_minutes, last_checked_at, last_changed_at, last_error_code, last_error_message, created_at, updated_at"
    )
    .maybeSingle();

  if (error) {
    return jsonError("MONITOR_UPDATE_FAILED", error.message, 500);
  }
  if (!updated) {
    return jsonError("MONITOR_NOT_FOUND", "Monitor not found.", 404);
  }

  if (validated.data.status === "active") {
    const supabaseAdmin = createSupabaseAdminClient();
    if (supabaseAdmin) {
      await sendMonitorActivationNotification(supabaseAdmin, id).catch(() => {});
    }
  }

  return NextResponse.json({ monitor: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { error } = await auth.supabase.from("monitors").delete().eq("id", id);
  if (error) {
    return jsonError("MONITOR_DELETE_FAILED", error.message, 500);
  }

  return NextResponse.json({ ok: true });
}
