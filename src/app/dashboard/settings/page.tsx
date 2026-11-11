import type { Metadata } from "next";
import { Suspense } from "react";
import { PhaseShellNotice } from "@/components/dashboard/phase-shell-notice";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_USAGE_LIMITS,
  DEFAULT_USER_SETTINGS,
} from "@/lib/auth/profile";
import { getCurrentAccountContext } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "User Settings",
};

async function UserSettingsContent() {
  const account = await getCurrentAccountContext();

  const fallbackSettings = {
    user_id: account.user?.id ?? "unconfigured",
    ...DEFAULT_USER_SETTINGS,
  };
  const fallbackLimits = {
    user_id: account.user?.id ?? "unconfigured",
    ...DEFAULT_USAGE_LIMITS,
    quota_reset_at: null,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          User Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile display name, default crawl cadence, email alert
          preferences, and usage limits.
        </p>
      </div>

      {!account.configured && (
        <PhaseShellNotice
          phase="Supabase Required"
          title="Connect Supabase credentials to persist profile & settings"
          description="Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and run supabase/migrations/0001_initial_schema.sql and 0002_rls_and_storage.sql."
        />
      )}

      <SettingsForm
        configured={account.configured}
        authenticated={Boolean(account.user)}
        profile={account.profile}
        settings={account.settings ?? fallbackSettings}
        usageLimits={account.usageLimits ?? fallbackLimits}
      />
    </div>
  );
}

export default function UserSettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <UserSettingsContent />
    </Suspense>
  );
}
