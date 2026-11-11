import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Create account",
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your SidCrawal account"
      description="Register with a work email to configure your first monitored page."
    >
      <Suspense fallback={<Skeleton className="h-72 w-full rounded-lg" />}>
        <AuthForm mode="register" supabaseConfigured={isSupabaseConfigured()} />
      </Suspense>
    </AuthShell>
  );
}
