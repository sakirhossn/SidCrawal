import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";
import { jsonError, parseValidatedJson, requireSupabaseClient } from "@/lib/auth/http";
import { getOriginFromRequest } from "@/lib/auth/redirect";
import { verifyResendSchema } from "@/lib/auth/schemas";
import { isResendConfigured } from "@/lib/email/client";
import { sendVerificationEmailViaResend } from "@/lib/email/notifications";
import { applyRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const rl = await applyRateLimit(request, "auth_recovery");
  if (!rl.allowed && rl.response) {
    return rl.response;
  }

  const validated = await parseValidatedJson(request, verifyResendSchema);
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
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email_verified_at")
      .eq("email", email)
      .maybeSingle<{ id: string; full_name: string | null; email_verified_at: string | null }>();

    if (profile && !profile.email_verified_at) {
      const { data: linkData, error: linkErr } =
        await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: {
            redirectTo: `${origin}/auth/callback?next=/dashboard`,
          },
        });

      if (!linkErr && linkData?.properties?.hashed_token) {
        const verificationUrl = `${origin}/auth/callback?token_hash=${encodeURIComponent(
          linkData.properties.hashed_token
        )}&type=magiclink&next=${encodeURIComponent("/dashboard")}`;

        await sendVerificationEmailViaResend({
          to: email,
          recipientName: profile.full_name,
          verificationUrl,
          appUrl: origin,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      emailProvider: "resend",
      message:
        "If that email is registered and unverified, a fresh verification link has been dispatched.",
    });
  }

  const { error } = await clientResult.supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    return jsonError("RESEND_FAILED", formatAuthError(error), 400);
  }

  return NextResponse.json({
    ok: true,
    message:
      "If that email is registered and unverified, a fresh verification link has been dispatched.",
  });
}
