import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentAccountContext } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Set new password",
};

async function ResetPasswordContent() {
  const account = await getCurrentAccountContext();

  return (
    <AuthForm
      mode="reset-password"
      supabaseConfigured={isSupabaseConfigured()}
      hasRecoverySession={Boolean(account.user)}
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      description="Choose a strong new password for your SidCrawal account."
    >
      <Suspense fallback={<Skeleton className="h-56 w-full rounded-lg" />}>
        <ResetPasswordContent />
      </Suspense>
    </AuthShell>
  );
}
