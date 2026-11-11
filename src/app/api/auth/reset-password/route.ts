import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";
import { jsonError, parseValidatedJson, requireSupabaseClient } from "@/lib/auth/http";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { applyRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const rl = await applyRateLimit(request, "auth_recovery");
  if (!rl.allowed && rl.response) {
    return rl.response;
  }

  const validated = await parseValidatedJson(request, resetPasswordSchema);
  if ("response" in validated) {
    return validated.response;
  }

  const clientResult = await requireSupabaseClient();
  if ("response" in clientResult) {
    return clientResult.response;
  }

  const { supabase } = clientResult;
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError(
      "RECOVERY_SESSION_REQUIRED",
      "Your password reset session is missing or expired. Request a new password reset link.",
      401
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: validated.data.password,
  });

  if (error) {
    return jsonError("PASSWORD_UPDATE_FAILED", formatAuthError(error), 400);
  }

  return NextResponse.json({
    ok: true,
    message: "Your password has been updated. You can continue to your dashboard.",
    redirectTo: "/dashboard",
  });
}
