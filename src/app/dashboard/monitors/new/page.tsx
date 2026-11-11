import type { Metadata } from "next";
import { Suspense } from "react";
import { NewMonitorForm } from "@/components/dashboard/new-monitor-form";
import { PhaseShellNotice } from "@/components/dashboard/phase-shell-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Add Monitor",
};

export default function AddMonitorPage() {
  const configured = isSupabaseConfigured();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Add Monitor
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Validate a public website URL and launch the isolated Playwright browser
          selection workspace.
        </p>
      </div>

      {!configured && (
        <PhaseShellNotice
          phase="Local Workspace Ready"
          title="Live Playwright rendering works; persistence requires Supabase"
          description="You can test URL SSRF validation and render live websites in the Selection Workspace immediately. Connect Supabase in .env.local to save monitors to PostgreSQL."
        />
      )}

      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <NewMonitorForm supabaseConfigured={configured} />
      </Suspense>
    </div>
  );
}
