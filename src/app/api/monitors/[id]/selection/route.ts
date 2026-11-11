import { NextResponse } from "next/server";
import { jsonError, parseValidatedJson } from "@/lib/auth/http";
import { sendMonitorActivationNotification } from "@/lib/email/notifications";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";
import { saveSelectionSchema } from "@/lib/monitors/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: monitorId } = await context.params;
  const validated = await parseValidatedJson(request, saveSelectionSchema);
  if ("response" in validated) {
    return validated.response;
  }

  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { supabase, user } = auth;

  const { data: monitor, error: monitorError } = await supabase
    .from("monitors")
    .select("id, url, status")
    .eq("id", monitorId)
    .maybeSingle<{ id: string; url: string; status: string }>();

  if (monitorError) {
    return jsonError("MONITOR_LOOKUP_FAILED", monitorError.message, 500);
  }
  if (!monitor) {
    return jsonError("MONITOR_NOT_FOUND", "Monitor not found.", 404);
  }

  const {
    selectionType,
    cssSelector,
    selectors,
    elementMetadata,
    boundingBox,
    viewportDimensions,
    selectedText,
    normalizationRules,
    activate,
  } = validated.data;

  // Deactivate previous active selections for this monitor
  const { error: deactivateError } = await supabase
    .from("monitor_selections")
    .update({ is_active: false })
    .eq("monitor_id", monitorId)
    .eq("is_active", true);

  if (deactivateError) {
    return jsonError("SELECTION_UPDATE_FAILED", deactivateError.message, 500);
  }

  const normalizedSelectors =
    selectors.length > 0
      ? selectors
      : cssSelector
        ? [cssSelector]
        : [];

  const { data: savedSelection, error: insertError } = await supabase
    .from("monitor_selections")
    .insert({
      monitor_id: monitorId,
      user_id: user.id,
      selection_type: selectionType,
      css_selector: cssSelector ?? normalizedSelectors[0] ?? null,
      selectors_json: normalizedSelectors,
      element_metadata: {
        ...elementMetadata,
        url: monitor.url,
      },
      bounding_box: boundingBox,
      viewport_dimensions: viewportDimensions,
      selected_text: selectedText,
      normalization_rules: normalizationRules,
      is_active: true,
    })
    .select(
      "id, monitor_id, selection_type, css_selector, selectors_json, element_metadata, bounding_box, viewport_dimensions, selected_text, normalization_rules, is_active, created_at, updated_at"
    )
    .single();

  if (insertError || !savedSelection) {
    return jsonError(
      "SELECTION_SAVE_FAILED",
      insertError?.message ?? "Failed to save monitor selection.",
      500
    );
  }

  let updatedStatus = monitor.status;
  if (activate) {
    const { error: activateError } = await supabase
      .from("monitors")
      .update({ status: "active" })
      .eq("id", monitorId);

    if (activateError) {
      return jsonError("MONITOR_ACTIVATION_FAILED", activateError.message, 500);
    }
    updatedStatus = "active";
    const supabaseAdmin = createSupabaseAdminClient();
    if (supabaseAdmin) {
      await sendMonitorActivationNotification(supabaseAdmin, monitorId).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    monitorStatus: updatedStatus,
    selection: savedSelection,
  });
}
