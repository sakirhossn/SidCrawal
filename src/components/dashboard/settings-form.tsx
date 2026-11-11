"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { updateSettingsSchema } from "@/lib/auth/schemas";
import type { UsageLimits, UserProfile, UserSettings } from "@/lib/auth/profile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SettingsFormProps {
  configured: boolean;
  authenticated: boolean;
  profile: UserProfile | null;
  settings: UserSettings;
  usageLimits: UsageLimits;
}

const INTERVAL_CHOICES = [5, 15, 30, 60, 180, 360, 720, 1440];

export function SettingsForm({
  configured,
  authenticated,
  profile,
  settings,
  usageLimits,
}: SettingsFormProps) {
  const router = useRouter();
  const { setTheme } = useTheme();

  const [fullName, setFullName] = React.useState(profile?.full_name ?? "");
  const [intervalMinutes, setIntervalMinutes] = React.useState(
    String(settings.default_check_interval_minutes)
  );
  const [timezone, setTimezone] = React.useState(settings.timezone);
  const [themePreference, setThemePreference] = React.useState<
    "light" | "dark" | "system"
  >(settings.theme_preference);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = React.useState(
    settings.email_notifications_enabled
  );
  const [weeklyDigestEnabled, setWeeklyDigestEnabled] = React.useState(
    settings.weekly_digest_enabled
  );
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const canSave = configured && authenticated;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsed = updateSettingsSchema.safeParse({
      fullName,
      defaultCheckIntervalMinutes: Number(intervalMinutes),
      emailNotificationsEnabled,
      weeklyDigestEnabled,
      timezone,
      themePreference,
    });

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Check your settings inputs.");
      return;
    }

    if (!canSave) {
      setErrorMessage(
        "Connect Supabase credentials and sign in to persist profile and settings changes."
      );
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        setErrorMessage(
          body.error?.message ?? "Failed to update settings. Please try again."
        );
        return;
      }

      setTheme(parsed.data.themePreference);
      setSuccessMessage(body.message ?? "Profile and monitor defaults saved.");
      router.refresh();
    } catch {
      setErrorMessage("Network error while saving settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <form onSubmit={handleSubmit} className="lg:col-span-7" noValidate>
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle>Profile &amp; Notification Defaults</CardTitle>
            <CardDescription>
              Stored in <code className="font-mono text-xs">profiles</code> and{" "}
              <code className="font-mono text-xs">user_settings</code> under RLS.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-5">
            <div className="space-y-1.5">
              <Label htmlFor="settings-email">Account email</Label>
              <Input
                id="settings-email"
                value={profile?.email ?? "Not signed in"}
                readOnly
                disabled
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-full-name">Full name</Label>
              <Input
                id="settings-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your display name"
                disabled={saving}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="settings-interval">Default check interval</Label>
                <select
                  id="settings-interval"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                  disabled={saving}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {INTERVAL_CHOICES.map((mins) => (
                    <option
                      key={mins}
                      value={mins}
                      disabled={mins < usageLimits.min_interval_minutes}
                    >
                      Every {mins} minutes
                      {mins < usageLimits.min_interval_minutes ? " (Pro+)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="settings-theme">Theme preference</Label>
                <select
                  id="settings-theme"
                  value={themePreference}
                  onChange={(e) =>
                    setThemePreference(
                      e.target.value as "light" | "dark" | "system"
                    )
                  }
                  disabled={saving}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="system">System default</option>
                  <option value="light">Light mode</option>
                  <option value="dark">Dark mode</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-timezone">Preferred timezone</Label>
              <Input
                id="settings-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="UTC"
                disabled={saving}
              />
            </div>

            <div className="space-y-2.5 pt-1">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-xs">
                <span>
                  <span className="block font-medium text-foreground">
                    Email change notifications
                  </span>
                  <span className="text-muted-foreground">
                    Receive alerts when monitored elements or regions change.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={emailNotificationsEnabled}
                  onChange={(e) => setEmailNotificationsEnabled(e.target.checked)}
                  disabled={saving}
                  className="size-4 accent-emerald-600"
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-xs">
                <span>
                  <span className="block font-medium text-foreground">
                    Weekly digest summary
                  </span>
                  <span className="text-muted-foreground">
                    Optional weekly overview of monitor activity (Phase 5).
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={weeklyDigestEnabled}
                  onChange={(e) => setWeeklyDigestEnabled(e.target.checked)}
                  disabled={saving}
                  className="size-4 accent-emerald-600"
                />
              </label>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300"
              >
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{successMessage}</span>
              </div>
            )}
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit" size="sm" disabled={saving || !canSave}>
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              )}
              <span>
                {!canSave
                  ? "Connect Supabase & Sign In to Save"
                  : saving
                    ? "Saving..."
                    : "Save Settings"}
              </span>
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Card className="lg:col-span-5">
        <CardHeader className="border-b border-border">
          <CardTitle>Plan &amp; Usage Limits</CardTitle>
          <CardDescription>
            Enforced server-side from <code className="font-mono text-xs">usage_limits</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-5 text-xs">
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <span className="text-muted-foreground">Plan tier</span>
            <span className="font-mono uppercase text-foreground">
              {usageLimits.plan_tier}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <span className="text-muted-foreground">Account role</span>
            <span className="font-mono text-foreground">
              {profile?.role ?? "user"}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <span className="text-muted-foreground">Maximum monitors</span>
            <span className="font-mono tabular-nums text-foreground">
              {usageLimits.max_monitors}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <span className="text-muted-foreground">Minimum interval</span>
            <span className="font-mono tabular-nums text-foreground">
              {usageLimits.min_interval_minutes} min
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Monthly crawls</span>
            <span className="font-mono tabular-nums text-foreground">
              {usageLimits.current_month_crawls.toLocaleString()} /{" "}
              {usageLimits.max_monthly_crawls.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
