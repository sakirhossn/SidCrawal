import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your registered email address to receive a password recovery link."
    >
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-lg" />}>
        <AuthForm
          mode="forgot-password"
          supabaseConfigured={isSupabaseConfigured()}
        />
      </Suspense>
    </AuthShell>
  );
}
