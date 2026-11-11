import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth/http";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: monitorId } = await context.params;
  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { supabase } = auth;

  const { data: monitor, error: monitorError } = await supabase
    .from("monitors")
    .select("id, active_baseline_snapshot_id")
    .eq("id", monitorId)
    .maybeSingle<{ id: string; active_baseline_snapshot_id: string | null }>();

  if (monitorError) {
    return jsonError("MONITOR_LOOKUP_FAILED", monitorError.message, 500);
  }
  if (!monitor) {
    return jsonError("MONITOR_NOT_FOUND", "Monitor not found.", 404);
  }

  const [runsRes, snapshotsRes, changesRes] = await Promise.all([
    supabase
      .from("crawl_runs")
      .select(
        "id, monitor_id, trigger_source, status, http_status, resolved_ip, duration_ms, error_code, error_message, started_at, completed_at"
      )
      .eq("monitor_id", monitorId)
      .order("started_at", { ascending: false })
      .limit(30),
    supabase
      .from("snapshots")
      .select(
        "id, monitor_id, crawl_run_id, is_baseline, page_title, extracted_text, normalized_text, content_hash, element_screenshot_path, full_page_screenshot_path, visual_hash, captured_at"
      )
      .eq("monitor_id", monitorId)
      .order("captured_at", { ascending: false })
      .limit(30),
    supabase
      .from("detected_changes")
      .select(
        "id, monitor_id, previous_snapshot_id, current_snapshot_id, change_type, visual_diff_percentage, diff_screenshot_path, previous_text_excerpt, current_text_excerpt, diff_summary, change_fingerprint, detected_at"
      )
      .eq("monitor_id", monitorId)
      .order("detected_at", { ascending: false })
      .limit(30),
  ]);

  return NextResponse.json({
    ok: true,
    activeBaselineSnapshotId: monitor.active_baseline_snapshot_id,
    crawlRuns: runsRes.data ?? [],
    snapshots: snapshotsRes.data ?? [],
    detectedChanges: changesRes.data ?? [],
  });
}
