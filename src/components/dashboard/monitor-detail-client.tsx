"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MonitorActionsBar({
  monitorId,
  status,
  hasSelection,
}: {
  monitorId: string;
  status: string;
  hasSelection: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [crawling, setCrawling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function toggleStatus() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const nextStatus = status === "active" ? "paused" : "active";
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message ?? "Could not update monitor status.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRunCrawl() {
    setError(null);
    setNotice(null);
    setCrawling(true);
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorId)}/crawl`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        persistence?: { outcome?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(data.error?.message ?? "Could not trigger manual crawl.");
        return;
      }
      if (!data.ok && data.error?.message) {
        setError(`Crawl failed safely (baseline preserved): ${data.error.message}`);
      } else {
        const label = data.persistence?.outcome ?? "completed";
        setNotice(`Crawl finished: ${label.replace(/_/g, " ")}.`);
      }
      router.refresh();
    } finally {
      setCrawling(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Failed to delete monitor.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={busy || crawling || !hasSelection}
          onClick={handleRunCrawl}
        >
          <RefreshCw
            className={`size-3.5 ${crawling ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>{crawling ? "Crawling..." : "Run Crawl Now"}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || crawling || (status !== "active" && !hasSelection)}
          onClick={toggleStatus}
        >
          {status === "active" ? (
            <>
              <Pause className="size-3.5" aria-hidden="true" />
              <span>Pause Monitor</span>
            </>
          ) : (
            <>
              <Play className="size-3.5" aria-hidden="true" />
              <span>Activate Monitor</span>
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy || crawling}
          onClick={handleDelete}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          <span>Delete</span>
        </Button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-1.5 text-xs text-destructive"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
