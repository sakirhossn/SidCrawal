import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";
import { ensureUserProfile } from "@/lib/auth/profile";
import { getOriginFromRequest, sanitizeRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "recovery",
  "invite",
  "email",
  "email_change",
  "magiclink",
]);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = getOriginFromRequest(request);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const typeParam = requestUrl.searchParams.get("type");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const nextPath = sanitizeRedirectPath(
    requestUrl.searchParams.get("next"),
    typeParam === "recovery" ? "/reset-password" : "/dashboard"
  );

  if (errorDescription) {
    const target = typeParam === "recovery" ? "/forgot-password" : "/login";
    const errUrl = new URL(target, origin);
    errUrl.searchParams.set("error", errorDescription);
    return NextResponse.redirect(errUrl);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const errUrl = new URL("/login", origin);
    errUrl.searchParams.set(
      "error",
      "Supabase environment variables are not configured."
    );
    return NextResponse.redirect(errUrl);
  }

  let authError: unknown = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    authError = error;
  } else if (
    tokenHash &&
    typeParam &&
    ALLOWED_OTP_TYPES.has(typeParam as EmailOtpType)
  ) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: typeParam as EmailOtpType,
    });
    authError = error;
  } else {
    const errUrl = new URL("/login", origin);
    errUrl.searchParams.set(
      "error",
      "Missing or invalid verification token. Request a fresh link to continue."
    );
    return NextResponse.redirect(errUrl);
  }

  if (authError) {
    const failureRoute =
      nextPath === "/reset-password" || typeParam === "recovery"
        ? "/forgot-password"
        : "/verify-email";
    const errUrl = new URL(failureRoute, origin);
    errUrl.searchParams.set("error", formatAuthError(authError));
    return NextResponse.redirect(errUrl);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await ensureUserProfile(supabase, user);
  }

  const destination = new URL(nextPath, origin);
  if (nextPath !== "/reset-password") {
    destination.searchParams.set("verified", "1");
  }
  return NextResponse.redirect(destination);
}
