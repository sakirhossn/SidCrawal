"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdminRecoverButtonProps {
  staleLockedCount: number;
  disabled?: boolean;
}

export function AdminRecoverButton({
  staleLockedCount,
  disabled = false,
}: AdminRecoverButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleRecover() {
    setLoading(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/admin/recover-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staleMinutes: 10 }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        recoveredCount?: number;
        error?: { message?: string };
      };

      if (!response.ok || !payload.ok) {
        setStatusMessage(
          payload.error?.message ?? "Failed to recover stale jobs."
        );
        return;
      }

      const count = payload.recoveredCount ?? 0;
      setStatusMessage(
        count > 0
          ? `Requeued ${count} stale job${count === 1 ? "" : "s"} into backoff.`
          : "No stale worker locks older than 10 minutes found."
      );
      router.refresh();
    } catch {
      setStatusMessage("Network error while recovering stale crawl locks.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || loading}
        onClick={handleRecover}
      >
        <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} />
        {loading
          ? "Recovering stale locks..."
          : `Recover stale locks (${staleLockedCount})`}
      </Button>
      {statusMessage ? (
        <span className="text-xs text-muted-foreground">{statusMessage}</span>
      ) : null}
    </div>
  );
}
