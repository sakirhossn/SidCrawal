import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  default_check_interval_minutes: number;
  email_notifications_enabled: boolean;
  weekly_digest_enabled: boolean;
  timezone: string;
  theme_preference: "light" | "dark" | "system";
}

export interface UsageLimits {
  user_id: string;
  plan_tier: "free" | "pro" | "enterprise";
  max_monitors: number;
  min_interval_minutes: number;
  max_monthly_crawls: number;
  current_month_crawls: number;
  quota_reset_at: string | null;
}

export const DEFAULT_USER_SETTINGS: Omit<UserSettings, "user_id"> = {
  default_check_interval_minutes: 60,
  email_notifications_enabled: true,
  weekly_digest_enabled: false,
  timezone: "UTC",
  theme_preference: "system",
};

export const DEFAULT_USAGE_LIMITS: Omit<UsageLimits, "user_id" | "quota_reset_at"> = {
  plan_tier: "free",
  max_monitors: 5,
  min_interval_minutes: 60,
  max_monthly_crawls: 2000,
  current_month_crawls: 0,
};

/**
 * Loads the authenticated user's profile, settings, and quota rows via RLS.
 * If the signup trigger has not yet created `profiles` or `user_settings`, creates
 * the missing rows strictly for the current `auth.uid()` with standard `user` role.
 */
export async function ensureUserProfile(
  supabase: SupabaseClient,
  user: User
): Promise<{
  profile: UserProfile | null;
  settings: UserSettings;
  usageLimits: UsageLimits;
}> {
  const email = user.email ?? "";
  const metadataName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim() || null
      : null;

  let { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, email_verified_at, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle<UserProfile>();

  if (!profile) {
    const { data: insertedProfile } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email,
          full_name: metadataName,
          role: "user",
          email_verified_at: user.email_confirmed_at ?? null,
        },
        { onConflict: "id" }
      )
      .select("id, email, full_name, role, email_verified_at, created_at, updated_at")
      .maybeSingle<UserProfile>();

    profile = insertedProfile ?? {
      id: user.id,
      email,
      full_name: metadataName,
      role: "user",
      email_verified_at: user.email_confirmed_at ?? null,
      created_at: user.created_at,
      updated_at: user.created_at,
    };
  }

  let { data: settings } = await supabase
    .from("user_settings")
    .select(
      "user_id, default_check_interval_minutes, email_notifications_enabled, weekly_digest_enabled, timezone, theme_preference"
    )
    .eq("user_id", user.id)
    .maybeSingle<UserSettings>();

  if (!settings) {
    const { data: insertedSettings } = await supabase
      .from("user_settings")
      .upsert({ user_id: user.id }, { onConflict: "user_id" })
      .select(
        "user_id, default_check_interval_minutes, email_notifications_enabled, weekly_digest_enabled, timezone, theme_preference"
      )
      .maybeSingle<UserSettings>();

    settings = insertedSettings ?? {
      user_id: user.id,
      ...DEFAULT_USER_SETTINGS,
    };
  }

  const { data: usageLimits } = await supabase
    .from("usage_limits")
    .select(
      "user_id, plan_tier, max_monitors, min_interval_minutes, max_monthly_crawls, current_month_crawls, quota_reset_at"
    )
    .eq("user_id", user.id)
    .maybeSingle<UsageLimits>();

  return {
    profile,
    settings,
    usageLimits: usageLimits ?? {
      user_id: user.id,
      ...DEFAULT_USAGE_LIMITS,
      quota_reset_at: null,
    },
  };
}
