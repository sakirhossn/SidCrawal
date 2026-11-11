import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  DashboardShell,
  type DashboardAccountSummary,
} from "@/components/dashboard/dashboard-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentAccountContext } from "@/lib/auth/session";

async function DashboardAuthGate({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentAccountContext();

  if (ctx.configured) {
    if (!ctx.user) {
      redirect("/login");
    }
    if (!ctx.user.email_confirmed_at) {
      const emailParam = ctx.user.email
        ? `&email=${encodeURIComponent(ctx.user.email)}`
        : "";
      redirect(`/verify-email?reason=unverified${emailParam}`);
    }
  }

  const account: DashboardAccountSummary = {
    configured: ctx.configured,
    authenticated: Boolean(ctx.user),
    email: ctx.profile?.email ?? ctx.user?.email ?? null,
    fullName: ctx.profile?.full_name ?? null,
    role: ctx.profile?.role ?? "user",
  };

  return <DashboardShell account={account}>{children}</DashboardShell>;
}

function DashboardShellFallback() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="hidden w-64 shrink-0 border-r border-border bg-sidebar p-4 lg:block">
        <Skeleton className="h-8 w-32" />
        <div className="mt-6 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-6 h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<DashboardShellFallback />}>
      <DashboardAuthGate>{children}</DashboardAuthGate>
    </Suspense>
  );
}
