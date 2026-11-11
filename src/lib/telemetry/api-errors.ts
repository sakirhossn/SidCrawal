import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Persists sanitized operational API/SSRF/rate-limit errors to `public.api_error_events`
 * for Admin Dashboard visibility. Best-effort and non-blocking; never throws or logs secrets.
 */
export async function recordApiErrorEvent(input: {
  route: string;
  method: string;
  statusCode: number;
  errorCode: string;
  message: string;
  userId?: string | null;
}): Promise<void> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    if (!supabaseAdmin) return;

    await supabaseAdmin.from("api_error_events").insert({
      route: input.route.slice(0, 160),
      method: input.method.slice(0, 16),
      status_code: input.statusCode,
      error_code: input.errorCode.slice(0, 80),
      message: input.message.slice(0, 400),
      user_id: input.userId ?? null,
    });
  } catch {
    // Non-blocking audit logging: never fail an API request due to telemetry insert error
  }
}
