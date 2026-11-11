import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PhaseShellNotice } from "@/components/dashboard/phase-shell-notice";
import { SignedSnapshotPreview } from "@/components/dashboard/signed-snapshot-preview";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentAccountContext } from "@/lib/auth/session";
import type { DetectedChangeRecord } from "@/lib/crawler/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Change History",
};

interface MonitorRef {
  name: string;
  url: string;
}

interface ChangeHistoryRow extends DetectedChangeRecord {
  monitors?: MonitorRef | MonitorRef[] | null;
}

async function ChangeHistoryContent() {
  const account = await getCurrentAccountContext();
  let changes: ChangeHistoryRow[] = [];

  if (account.configured && account.user) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data } = await supabase
        .from("detected_changes")
        .select(
          "id, monitor_id, user_id, previous_snapshot_id, current_snapshot_id, change_type, visual_diff_percentage, diff_screenshot_path, previous_text_excerpt, current_text_excerpt, diff_summary, change_fingerprint, detected_at, monitors(name, url)"
        )
        .order("detected_at", { ascending: false })
        .limit(40);
      changes = (data ?? []) as unknown as ChangeHistoryRow[];
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Change History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspect visual pixel diffs, previous vs. current screenshots, and normalized
            text changes detected across your monitors.
          </p>
        </div>

        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to Overview
        </Link>
      </div>

      {!account.configured && (
        <PhaseShellNotice
          phase="Phase 4 Ready"
          title="Connect Supabase credentials to persist change history"
          description="Meaningful changes detected by text comparison and pixel diffing are recorded in detected_changes with private Storage artifacts."
        />
      )}

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>Detected Changes</CardTitle>
          <CardDescription>
            {changes.length} recorded diff{changes.length === 1 ? "" : "s"} • Identical
            consecutive transitions are deduplicated automatically via change_fingerprint.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {changes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-xs text-muted-foreground">
              No change events recorded yet. Activate a monitor and run crawls to track
              baseline diffs over time.
            </div>
          ) : (
            <div className="space-y-4">
              {changes.map((change) => (
                <div
                  key={change.id}
                  className="space-y-3 rounded-lg border border-border bg-background p-4 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Link
                        href={`/dashboard/monitors/${change.monitor_id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {(Array.isArray(change.monitors)
                          ? change.monitors[0]?.name
                          : change.monitors?.name) ?? "Monitored Target"}
                      </Link>
                      {(Array.isArray(change.monitors)
                        ? change.monitors[0]?.url
                        : change.monitors?.url) && (
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {Array.isArray(change.monitors)
                            ? change.monitors[0]?.url
                            : change.monitors?.url}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                      <Badge variant="outline">{change.change_type}</Badge>
                      {change.visual_diff_percentage !== null && (
                        <Badge variant="outline">
                          {change.visual_diff_percentage}% visual delta
                        </Badge>
                      )}
                      <span className="text-muted-foreground">
                        {new Date(change.detected_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <div className="mb-1 font-medium text-muted-foreground">
                        Previous normalized text
                      </div>
                      <p className="break-words text-foreground">
                        {change.previous_text_excerpt || "(empty)"}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-emerald-500/5 p-2.5">
                      <div className="mb-1 font-medium text-emerald-700 dark:text-emerald-300">
                        Current normalized text
                      </div>
                      <p className="break-words text-foreground">
                        {change.current_text_excerpt || "(empty)"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 pt-1">
                    <SignedSnapshotPreview
                      recordId={change.previous_snapshot_id}
                      variant="element"
                      label="Previous Snapshot"
                    />
                    <SignedSnapshotPreview
                      recordId={change.current_snapshot_id}
                      variant="element"
                      label="Current Snapshot"
                    />
                    {change.diff_screenshot_path && (
                      <SignedSnapshotPreview
                        recordId={change.id}
                        variant="diff"
                        label="Visual Diff Overlay"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ChangeHistoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <ChangeHistoryContent />
    </Suspense>
  );
}
