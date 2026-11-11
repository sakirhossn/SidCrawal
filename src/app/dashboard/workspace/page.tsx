import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceStudio } from "@/components/dashboard/workspace-studio";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Selection Workspace",
};

export default function SelectionWorkspacePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Website Selection Workspace
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Render public websites inside an isolated Playwright browser, target DOM
          elements or visual bounding boxes, and save selections for monitoring.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
        <WorkspaceStudio supabaseConfigured={isSupabaseConfigured()} />
      </Suspense>
    </div>
  );
}
