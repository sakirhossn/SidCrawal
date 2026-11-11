"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, ShieldAlert } from "lucide-react";
import { validateTargetUrl } from "@/lib/url-validation";
import type { MonitorRecord } from "@/lib/preview/types";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INTERVAL_OPTIONS = [
  { label: "Every 15 minutes", value: "15" },
  { label: "Every 30 minutes", value: "30" },
  { label: "Every 1 hour", value: "60" },
  { label: "Every 6 hours", value: "360" },
  { label: "Every 24 hours", value: "1440" },
];

export function NewMonitorForm({
  supabaseConfigured,
}: {
  supabaseConfigured: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrl = searchParams.get("url") ?? "";

  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState(initialUrl);
  const [interval, setInterval] = React.useState("60");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function handleContinue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const res = validateTargetUrl(url);
    if (!res.valid || !res.normalizedUrl) {
      setErrorMessage(res.reason ?? "Enter a valid public HTTP/HTTPS URL.");
      return;
    }

    const query = new URLSearchParams({
      url: res.normalizedUrl,
      interval,
    });
    if (name.trim()) {
      query.set("name", name.trim());
    }

    if (!supabaseConfigured) {
      router.push(`/dashboard/workspace?${query.toString()}`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || res.host || "Website Monitor",
          url: res.normalizedUrl,
          checkIntervalMinutes: Number(interval),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        monitor?: MonitorRecord;
        error?: { message?: string };
      };

      if (!response.ok || !data.monitor) {
        setErrorMessage(data.error?.message ?? "Unable to create monitor.");
        return;
      }

      router.push(`/dashboard/workspace?monitorId=${encodeURIComponent(data.monitor.id)}`);
    } catch {
      setErrorMessage("Network error while creating monitor draft.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleContinue} noValidate>
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>Monitor Target Configuration</CardTitle>
          <CardDescription>
            Validate a public website URL and continue to the isolated Playwright
            selection workspace.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="space-y-1.5">
            <Label htmlFor="monitor-name">Monitor label</Label>
            <Input
              id="monitor-name"
              placeholder="e.g. Competitor Pricing — Pro Plan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="monitor-url">Target public URL</Label>
            <Input
              id="monitor-url"
              type="url"
              className="font-mono text-sm"
              placeholder="https://example.com/pricing"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              disabled={submitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              Only public <code className="font-mono">http://</code> and{" "}
              <code className="font-mono">https://</code> targets are accepted. Localhost,
              private IPv4/IPv6 ranges, and metadata hosts are rejected.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="monitor-interval">Check frequency</Label>
            <select
              id="monitor-interval"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              disabled={submitting}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/dashboard/workspace"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Open Workspace Directly
          </Link>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            )}
            <span>Open in Selection Workspace</span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
