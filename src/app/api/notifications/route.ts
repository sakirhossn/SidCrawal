import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth/http";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";

export async function GET() {
  const auth = await requireVerifiedMonitorSession();
  if ("response" in auth) {
    return auth.response;
  }

  const { supabase } = auth;
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, monitor_id, detected_change_id, notification_type, recipient_email, subject, status, provider_message_id, error_message, sent_at, created_at, monitors(name, url)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return jsonError("NOTIFICATIONS_FETCH_FAILED", error.message, 500);
  }

  return NextResponse.json({
    ok: true,
    notifications: data ?? [],
  });
}
