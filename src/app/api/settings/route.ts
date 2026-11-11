import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";
import { jsonError, parseValidatedJson, requireSupabaseClient } from "@/lib/auth/http";
import { ensureUserProfile } from "@/lib/auth/profile";
import { updateSettingsSchema } from "@/lib/auth/schemas";

export async function GET() {
  const clientResult = await requireSupabaseClient();
  if ("response" in clientResult) {
    return clientResult.response;
  }

  const { supabase } = clientResult;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonError("UNAUTHORIZED", "Authentication is required.", 401);
  }
  if (!user.email_confirmed_at) {
    return jsonError(
      "EMAIL_NOT_CONFIRMED",
      "Verify your email address before accessing account settings.",
      403
    );
  }

  const { profile, settings, usageLimits } = await ensureUserProfile(supabase, user);

  return NextResponse.json({
    profile,
    settings,
    usageLimits,
  });
}

export async function PATCH(request: Request) {
  const validated = await parseValidatedJson(request, updateSettingsSchema);
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
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonError("UNAUTHORIZED", "Sign in again before saving settings.", 401);
  }
  if (!user.email_confirmed_at) {
    return jsonError(
      "EMAIL_NOT_CONFIRMED",
      "Verify your email address before updating settings.",
      403
    );
  }

  await ensureUserProfile(supabase, user);

  const {
    fullName,
    defaultCheckIntervalMinutes,
    emailNotificationsEnabled,
    weeklyDigestEnabled,
    timezone,
    themePreference,
  } = validated.data;

  // Check user's quota floor from usage_limits
  const { data: limits } = await supabase
    .from("usage_limits")
    .select("min_interval_minutes")
    .eq("user_id", user.id)
    .maybeSingle<{ min_interval_minutes: number }>();

  const minAllowed = limits?.min_interval_minutes ?? 60;
  if (defaultCheckIntervalMinutes < minAllowed) {
    return jsonError(
      "INTERVAL_BELOW_PLAN_MINIMUM",
      `Your current plan requires a minimum check interval of ${minAllowed} minutes.`,
      400
    );
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", user.id);

  if (profileError) {
    return jsonError(
      "PROFILE_UPDATE_FAILED",
      formatAuthError(profileError, "Failed to update your profile name."),
      400
    );
  }

  const { data: updatedSettings, error: settingsError } = await supabase
    .from("user_settings")
    .update({
      default_check_interval_minutes: defaultCheckIntervalMinutes,
      email_notifications_enabled: emailNotificationsEnabled,
      weekly_digest_enabled: weeklyDigestEnabled,
      timezone,
      theme_preference: themePreference,
    })
    .eq("user_id", user.id)
    .select(
      "user_id, default_check_interval_minutes, email_notifications_enabled, weekly_digest_enabled, timezone, theme_preference"
    )
    .single();

  if (settingsError) {
    return jsonError(
      "SETTINGS_UPDATE_FAILED",
      formatAuthError(settingsError, "Failed to update notification and crawl defaults."),
      400
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Profile and monitor defaults saved.",
    settings: updatedSettings,
  });
}
