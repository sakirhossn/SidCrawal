import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";
import { jsonError, parseValidatedJson, requireSupabaseClient } from "@/lib/auth/http";
import { getOriginFromRequest } from "@/lib/auth/redirect";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import { isResendConfigured } from "@/lib/email/client";
import { sendPasswordResetEmailViaResend } from "@/lib/email/notifications";
import { applyRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const rl = await applyRateLimit(request, "auth_recovery");
  if (!rl.allowed && rl.response) {
    return rl.response;
  }

  const validated = await parseValidatedJson(request, forgotPasswordSchema);
  if ("response" in validated) {
    return validated.response;
  }

  const clientResult = await requireSupabaseClient();
  if ("response" in clientResult) {
    return clientResult.response;
  }

  const origin = getOriginFromRequest(request);
  const email = validated.data.email;

  const supabaseAdmin = createSupabaseAdminClient();
  if (isResendConfigured() && supabaseAdmin) {
    const { data: linkData, error: linkErr } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: `${origin}/auth/callback?next=/reset-password`,
        },
      });

    if (!linkErr && linkData?.properties?.hashed_token) {
      const resetUrl = `${origin}/auth/callback?token_hash=${encodeURIComponent(
        linkData.properties.hashed_token
      )}&type=recovery&next=${encodeURIComponent("/reset-password")}`;

      const fullName =
        typeof linkData.user?.user_metadata?.full_name === "string"
          ? linkData.user.user_metadata.full_name
          : null;

      await sendPasswordResetEmailViaResend({
        to: email,
        recipientName: fullName,
        resetUrl,
        appUrl: origin,
      });
    }

    return NextResponse.json({
      ok: true,
      emailProvider: "resend",
      message:
        "If an account exists for that email address, a password reset link has been sent.",
    });
  }

  const { error } = await clientResult.supabase.auth.resetPasswordForEmail(
    email,
    {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    }
  );

  if (error) {
    return jsonError("RESET_REQUEST_FAILED", formatAuthError(error), 400);
  }

  return NextResponse.json({
    ok: true,
    message:
      "If an account exists for that email address, a password reset link has been sent.",
  });
}
