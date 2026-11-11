import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Verify email",
};

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Verify your email address"
      description="Confirm ownership of your email address before activating scheduled monitors."
    >
      <Suspense fallback={<Skeleton className="h-60 w-full rounded-lg" />}>
        <AuthForm mode="verify-email" supabaseConfigured={isSupabaseConfigured()} />
      </Suspense>
    </AuthShell>
  );
}
