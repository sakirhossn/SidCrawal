import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth/http";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SNAPSHOT_BUCKET = "monitor-snapshots";
const SIGNED_URL_TTL_SECONDS = 180;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const variant =
    new URL(request.url).searchParams.get("variant") ?? "element";

  if (variant !== "element" && variant !== "full" && variant !== "diff") {
    return jsonError(
      "INVALID_VARIANT",
      "Query parameter `variant` must be element, full, or diff.",
      400
    );
  }

  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { supabase } = auth;
  let storagePath: string | null = null;

  if (variant === "diff") {
    const { data: change, error } = await supabase
      .from("detected_changes")
      .select("id, diff_screenshot_path")
      .eq("id", id)
      .maybeSingle<{ id: string; diff_screenshot_path: string | null }>();

    if (error) {
      return jsonError("CHANGE_LOOKUP_FAILED", error.message, 500);
    }
    if (!change) {
      return jsonError("NOT_FOUND", "Detected change record not found.", 404);
    }
    storagePath = change.diff_screenshot_path;
  } else {
    const { data: snap, error } = await supabase
      .from("snapshots")
      .select("id, element_screenshot_path, full_page_screenshot_path")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        element_screenshot_path: string | null;
        full_page_screenshot_path: string | null;
      }>();

    if (error) {
      return jsonError("SNAPSHOT_LOOKUP_FAILED", error.message, 500);
    }
    if (!snap) {
      return jsonError("NOT_FOUND", "Snapshot record not found.", 404);
    }
    storagePath =
      variant === "full"
        ? snap.full_page_screenshot_path
        : snap.element_screenshot_path;
  }

  if (!storagePath) {
    return jsonError(
      "SCREENSHOT_MISSING",
      `No ${variant} screenshot stored for this record.`,
      404
    );
  }

  const storageClient = createSupabaseAdminClient() ?? supabase;
  const { data: signed, error: signErr } = await storageClient.storage
    .from(SNAPSHOT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    return jsonError(
      "SIGNED_URL_FAILED",
      signErr?.message ?? "Could not create signed screenshot URL.",
      500
    );
  }

  return NextResponse.json(
    {
      ok: true,
      variant,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      signedUrl: signed.signedUrl,
    },
    { status: 200 }
  );
}
