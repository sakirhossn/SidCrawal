import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Crosshair, History } from "lucide-react";
import { MonitorActionsBar } from "@/components/dashboard/monitor-detail-client";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentAccountContext } from "@/lib/auth/session";
import type {
  CrawlRunRecord,
  DetectedChangeRecord,
  SnapshotRecord,
} from "@/lib/crawler/types";
import type { MonitorRecord, MonitorSelectionRecord } from "@/lib/preview/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Monitor Details",
};

interface MonitorDetailRow extends MonitorRecord {
  active_baseline_snapshot_id: string | null;
}

async function MonitorDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await getCurrentAccountContext();

  let monitor: MonitorDetailRow | null = null;
  let selection: MonitorSelectionRecord | null = null;
  let baselineSnapshot: SnapshotRecord | null = null;
  let crawlRuns: CrawlRunRecord[] = [];
  let detectedChanges: DetectedChangeRecord[] = [];

  if (account.configured && account.user && id !== "sample-monitor") {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const [{ data: mData }, { data: sData }, { data: rData }, { data: cData }] =
        await Promise.all([
          supabase
            .from("monitors")
            .select(
              "id, name, url, normalized_host, status, check_interval_minutes, active_baseline_snapshot_id, last_checked_at, last_changed_at, last_error_code, last_error_message, created_at, updated_at"
            )
            .eq("id", id)
            .maybeSingle<MonitorDetailRow>(),
          supabase
            .from("monitor_selections")
            .select(
              "id, monitor_id, selection_type, css_selector, selectors_json, element_metadata, bounding_box, viewport_dimensions, selected_text, normalization_rules, is_active, created_at, updated_at"
            )
            .eq("monitor_id", id)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<MonitorSelectionRecord>(),
          supabase
            .from("crawl_runs")
            .select(
              "id, monitor_id, user_id, job_id, trigger_source, status, http_status, resolved_ip, duration_ms, error_code, error_message, started_at, completed_at"
            )
            .eq("monitor_id", id)
            .order("started_at", { ascending: false })
            .limit(20),
          supabase
            .from("detected_changes")
            .select(
              "id, monitor_id, user_id, previous_snapshot_id, current_snapshot_id, change_type, visual_diff_percentage, diff_screenshot_path, previous_text_excerpt, current_text_excerpt, diff_summary, change_fingerprint, detected_at"
            )
            .eq("monitor_id", id)
            .order("detected_at", { ascending: false })
            .limit(20),
        ]);

      monitor = mData ?? null;
      selection = sData ?? null;
      crawlRuns = (rData ?? []) as CrawlRunRecord[];
      detectedChanges = (cData ?? []) as DetectedChangeRecord[];

      if (monitor?.active_baseline_snapshot_id) {
        const { data: snapData } = await supabase
          .from("snapshots")
          .select(
            "id, monitor_id, user_id, crawl_run_id, is_baseline, page_title, extracted_html, extracted_text, normalized_text, content_hash, element_screenshot_path, full_page_screenshot_path, visual_hash, captured_at"
          )
          .eq("id", monitor.active_baseline_snapshot_id)
          .maybeSingle<SnapshotRecord>();
        baselineSnapshot = snapData ?? null;
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {monitor ? monitor.name : "Monitor Detail Layout"}
            </h1>
            <Badge variant="outline" className="font-mono text-xs font-normal">
              {monitor ? monitor.status : `id: ${id}`}
            </Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {monitor
              ? `${monitor.url} • every ${monitor.check_interval_minutes} minutes`
              : "Baseline snapshot, CSS selector target, and crawl execution timeline."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={
              monitor
                ? `/dashboard/workspace?monitorId=${encodeURIComponent(monitor.id)}`
                : "/dashboard/workspace"
            }
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Crosshair className="size-3.5" aria-hidden="true" />
            <span>Edit Selection</span>
          </Link>
          <Link
            href="/dashboard/history"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <History className="size-3.5" aria-hidden="true" />
            <span>Change History</span>
          </Link>
        </div>
      </div>

      {monitor && (
        <MonitorActionsBar
          monitorId={monitor.id}
          status={monitor.status}
          hasSelection={Boolean(selection)}
        />
      )}

      {!monitor && (
        <PhaseShellNotice
          phase={account.configured ? "No Record Found" : "Phase 3–4"}
          title={
            account.configured
              ? `No monitor found with ID "${id}"`
              : "Connect Supabase to view persisted monitor records"
          }
          description="Use the Selection Workspace to render a target website and persist its CSS selector, element metadata, and coordinates."
        />
      )}

      <Tabs defaultValue="selection">
        <TabsList>
          <TabsTrigger value="selection">Selector Metadata</TabsTrigger>
          <TabsTrigger value="baseline">Baseline Snapshot</TabsTrigger>
          <TabsTrigger value="runs">
            Crawl Runs ({crawlRuns.length})
          </TabsTrigger>
          <TabsTrigger value="changes">
            Changes ({detectedChanges.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="selection" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>Target Selection Specification</CardTitle>
              <CardDescription>
                Persisted CSS selector, bounding box coordinates, viewport dimensions, and
                extracted text attached to this monitor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selection ? (
                <dl className="grid gap-4 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Selection Type</dt>
                    <dd className="mt-1 font-mono text-foreground">
                      {selection.selection_type}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Viewport Dimensions</dt>
                    <dd className="mt-1 font-mono tabular-nums text-foreground">
                      {selection.viewport_dimensions.width} ×{" "}
                      {selection.viewport_dimensions.height}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">CSS Selector</dt>
                    <dd className="mt-1 break-all rounded-md border border-border bg-muted/40 p-2.5 font-mono text-foreground">
                      {selection.css_selector ?? "(Visual bounding-box region)"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Bounding Box (px)</dt>
                    <dd className="mt-1 font-mono tabular-nums text-foreground">
                      {selection.bounding_box
                        ? `x:${selection.bounding_box.x}, y:${selection.bounding_box.y}, w:${selection.bounding_box.width}, h:${selection.bounding_box.height}`
                        : "N/A"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Selected Element Text</dt>
                    <dd className="mt-1 rounded-md border border-border bg-muted/40 p-2.5 text-foreground">
                      {selection.selected_text || "No text extracted"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/25 p-8 text-center text-xs text-muted-foreground">
                  No selection saved yet. Open the{" "}
                  <Link href="/dashboard/workspace" className="underline">
                    Selection Workspace
                  </Link>{" "}
                  to target an element or visual region.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="baseline" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>Active Baseline Snapshot</CardTitle>
              <CardDescription>
                Successful baselines are preserved automatically whenever a crawl attempt
                encounters a network timeout or upstream HTTP error.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {baselineSnapshot ? (
                <div className="space-y-4 text-xs">
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Captured At</dt>
                      <dd className="mt-1 font-mono text-foreground">
                        {new Date(baselineSnapshot.captured_at).toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Content Hash</dt>
                      <dd className="mt-1 truncate font-mono text-foreground">
                        {baselineSnapshot.content_hash}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">Normalized Baseline Text</dt>
                      <dd className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 text-foreground">
                        {baselineSnapshot.normalized_text || "(empty)"}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-3">
                    {baselineSnapshot.element_screenshot_path && (
                      <SignedSnapshotPreview
                        recordId={baselineSnapshot.id}
                        variant="element"
                        label="Element Screenshot"
                      />
                    )}
                    {baselineSnapshot.full_page_screenshot_path && (
                      <SignedSnapshotPreview
                        recordId={baselineSnapshot.id}
                        variant="full"
                        label="Full-Page Screenshot"
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/25 p-8 text-center text-xs text-muted-foreground">
                  No baseline snapshot captured yet. Click &ldquo;Run Crawl Now&rdquo; or
                  wait for the next scheduled dispatch.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>Execution Log</CardTitle>
              <CardDescription>
                Chronological history of scheduled, baseline, and manual Playwright visits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {crawlRuns.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/25 p-8 text-center text-xs text-muted-foreground">
                  0 crawl runs recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {crawlRuns.map((run) => (
                    <div
                      key={run.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 font-mono">
                          <Badge variant="outline">{run.status}</Badge>
                          <span className="text-muted-foreground">
                            {run.trigger_source}
                          </span>
                          {run.http_status && (
                            <span className="text-muted-foreground">
                              HTTP {run.http_status}
                            </span>
                          )}
                          {run.duration_ms !== null && (
                            <span className="tabular-nums text-muted-foreground">
                              {run.duration_ms}ms
                            </span>
                          )}
                        </div>
                        {run.error_message && (
                          <div className="text-destructive">
                            [{run.error_code ?? "ERROR"}] {run.error_message}
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {new Date(run.started_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="changes" className="pt-3">
          <Card>
            <CardHeader>
              <CardTitle>Detected Changes</CardTitle>
              <CardDescription>
                Meaningful visual and normalized text changes for this monitor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detectedChanges.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/25 p-8 text-center text-xs text-muted-foreground">
                  No changes detected yet for this monitor.
                </div>
              ) : (
                <div className="space-y-3">
                  {detectedChanges.map((change) => (
                    <div
                      key={change.id}
                      className="space-y-2 rounded-lg border border-border p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{change.change_type}</Badge>
                          {change.visual_diff_percentage !== null && (
                            <span>{change.visual_diff_percentage}% delta</span>
                          )}
                        </div>
                        <span className="text-muted-foreground">
                          {new Date(change.detected_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        Before: {change.previous_text_excerpt || "(empty)"}
                      </p>
                      <p className="text-foreground">
                        After: {change.current_text_excerpt || "(empty)"}
                      </p>
                      {change.diff_screenshot_path && (
                        <SignedSnapshotPreview
                          recordId={change.id}
                          variant="diff"
                          label="Visual Diff Image"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function MonitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <MonitorDetailContent params={params} />
    </Suspense>
  );
}
