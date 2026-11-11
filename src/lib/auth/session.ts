import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  ensureUserProfile,
  type UsageLimits,
  type UserProfile,
  type UserSettings,
} from "@/lib/auth/profile";

export interface AccountContext {
  configured: boolean;
  user: User | null;
  profile: UserProfile | null;
  settings: UserSettings | null;
  usageLimits: UsageLimits | null;
}

/**
 * Request-scoped Server helper verifying the current user via `supabase.auth.getUser()`.
 * Note: Call inside a `<Suspense>` boundary when `cacheComponents: true` is active.
 */
export async function getCurrentAccountContext(): Promise<AccountContext> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      user: null,
      profile: null,
      settings: null,
      usageLimits: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      configured: false,
      user: null,
      profile: null,
      settings: null,
      usageLimits: null,
    };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      configured: true,
      user: null,
      profile: null,
      settings: null,
      usageLimits: null,
    };
  }

  const { profile, settings, usageLimits } = await ensureUserProfile(
    supabase,
    user
  );

  return {
    configured: true,
    user,
    profile,
    settings,
    usageLimits,
  };
}
