import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";
import { jsonError, parseValidatedJson, requireSupabaseClient } from "@/lib/auth/http";
import { ensureUserProfile } from "@/lib/auth/profile";
import { getOriginFromRequest } from "@/lib/auth/redirect";
import { registerSchema } from "@/lib/auth/schemas";
import { isResendConfigured } from "@/lib/email/client";
import { sendVerificationEmailViaResend } from "@/lib/email/notifications";
import { applyRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const rl = await applyRateLimit(request, "auth_register");
  if (!rl.allowed && rl.response) {
    return rl.response;
  }

  const validated = await parseValidatedJson(request, registerSchema);
  if ("response" in validated) {
    return validated.response;
  }

  const clientResult = await requireSupabaseClient();
  if ("response" in clientResult) {
    return clientResult.response;
  }

  const { supabase } = clientResult;
  const origin = getOriginFromRequest(request);
  const { fullName, email, password } = validated.data;

  // Use Resend + Admin generateLink when both Resend and service_role are configured
  const supabaseAdmin = createSupabaseAdminClient();
  if (isResendConfigured() && supabaseAdmin) {
    const { data: linkData, error: linkErr } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: {
          data: { full_name: fullName },
          redirectTo: `${origin}/auth/callback?next=/dashboard`,
        },
      });

    if (linkErr || !linkData?.properties?.hashed_token) {
      const msg = linkErr?.message?.toLowerCase() ?? "";
      if (msg.includes("already") && msg.includes("registered")) {
        return jsonError(
          "USER_ALREADY_EXISTS",
          "An account with this email already exists. Try signing in or resetting your password.",
          409
        );
      }
      return jsonError(
        "SIGNUP_FAILED",
        formatAuthError(linkErr ?? "Failed creating verification link."),
        400
      );
    }

    const verificationUrl = `${origin}/auth/callback?token_hash=${encodeURIComponent(
      linkData.properties.hashed_token
    )}&type=signup&next=${encodeURIComponent("/dashboard")}`;

    const sent = await sendVerificationEmailViaResend({
      to: email,
      recipientName: fullName,
      verificationUrl,
      appUrl: origin,
    });

    if (!sent.ok) {
      return jsonError(
        "EMAIL_DISPATCH_FAILED",
        sent.error ?? "Account created, but verification email failed to send via Resend.",
        502
      );
    }

    return NextResponse.json(
      {
        ok: true,
        requiresEmailVerification: true,
        emailProvider: "resend",
        message:
          "Account created. Check your inbox for the SidCrawal verification email before signing in.",
      },
      { status: 201 }
    );
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    return jsonError("SIGNUP_FAILED", formatAuthError(error), 400);
  }

  // Supabase returns an empty identities array when email already exists and confirmation is on
  if (
    data.user &&
    Array.isArray(data.user.identities) &&
    data.user.identities.length === 0
  ) {
    return jsonError(
      "USER_ALREADY_EXISTS",
      "An account with this email already exists. Try signing in or resetting your password.",
      409
    );
  }

  if (data.session && data.user) {
    await ensureUserProfile(supabase, data.user);
  }

  const requiresEmailVerification = !data.session || !data.user?.email_confirmed_at;

  return NextResponse.json(
    {
      ok: true,
      requiresEmailVerification,
      message: requiresEmailVerification
        ? "Account created. Check your inbox for the verification link before signing in."
        : "Account created and signed in.",
    },
    { status: 201 }
  );
}
