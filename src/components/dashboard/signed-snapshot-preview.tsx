"use client";

import * as React from "react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignedSnapshotPreview({
  recordId,
  variant,
  label,
}: {
  recordId: string;
  variant: "element" | "full" | "diff";
  label: string;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function loadSignedUrl() {
    if (url) {
      setUrl(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/snapshots/${encodeURIComponent(recordId)}/signed-url?variant=${variant}`
      );
      const data = (await res.json().catch(() => ({}))) as {
        signedUrl?: string;
        error?: { message?: string };
      };
      if (!res.ok || !data.signedUrl) {
        setError(data.error?.message ?? "Failed generating signed screenshot URL.");
        return;
      }
      setUrl(data.signedUrl);
    } catch {
      setError("Network error while loading signed screenshot.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={loadSignedUrl}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        ) : (
          <ImageIcon className="size-3" aria-hidden="true" />
        )}
        <span>{url ? `Hide ${label}` : `View ${label}`}</span>
      </Button>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {url && (
        <div className="overflow-hidden rounded-lg border border-border bg-white p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            className="max-h-96 w-auto max-w-full rounded-md object-contain"
          />
        </div>
      )}
    </div>
  );
}
