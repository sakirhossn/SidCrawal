import { NextResponse } from "next/server";
import { formatAuthError, isEmailNotConfirmedError } from "@/lib/auth/errors";
import { jsonError, parseValidatedJson, requireSupabaseClient } from "@/lib/auth/http";
import { ensureUserProfile } from "@/lib/auth/profile";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { loginSchema } from "@/lib/auth/schemas";
import { applyRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const rl = await applyRateLimit(request, "auth_login");
  if (!rl.allowed && rl.response) {
    return rl.response;
  }

  const validated = await parseValidatedJson(request, loginSchema);
  if ("response" in validated) {
    return validated.response;
  }

  const clientResult = await requireSupabaseClient();
  if ("response" in clientResult) {
    return clientResult.response;
  }

  const { supabase } = clientResult;
  const { email, password, next } = validated.data;
  const redirectTo = sanitizeRedirectPath(next, "/dashboard");

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const emailUnconfirmed = isEmailNotConfirmedError(error);
    return jsonError(
      emailUnconfirmed ? "EMAIL_NOT_CONFIRMED" : "LOGIN_FAILED",
      formatAuthError(error),
      emailUnconfirmed ? 403 : 401
    );
  }

  if (!data.user) {
    return jsonError(
      "LOGIN_FAILED",
      "Unable to establish an authenticated session.",
      401
    );
  }

  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut();
    return jsonError(
      "EMAIL_NOT_CONFIRMED",
      "Verify your email address before accessing the dashboard. Request a new verification link if needed.",
      403
    );
  }

  await ensureUserProfile(supabase, data.user);

  return NextResponse.json({
    ok: true,
    redirectTo,
  });
}
