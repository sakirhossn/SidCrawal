import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in to SidCrawal"
      description="Access your website monitors, DOM selection studio, and verified diff history."
    >
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <AuthForm mode="login" supabaseConfigured={isSupabaseConfigured()} />
      </Suspense>
    </AuthShell>
  );
}
