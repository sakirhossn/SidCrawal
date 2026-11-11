import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { jsonError, requireSupabaseClient } from "@/lib/auth/http";
import { ensureUserProfile } from "@/lib/auth/profile";

export async function requireVerifiedMonitorSession(): Promise<
  | { supabase: SupabaseClient; user: User }
  | { response: NextResponse }
> {
  const clientResult = await requireSupabaseClient();
  if ("response" in clientResult) {
    return clientResult;
  }

  const { supabase } = clientResult;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { response: jsonError("UNAUTHORIZED", "Sign in to manage monitors.", 401) };
  }

  if (!user.email_confirmed_at) {
    return {
      response: jsonError(
        "EMAIL_NOT_CONFIRMED",
        "Verify your email address before saving or activating monitors.",
        403
      ),
    };
  }

  await ensureUserProfile(supabase, user);
  return { supabase, user };
}
