"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { validateTargetUrl } from "@/lib/url-validation";
import { AnimatedButton } from "@/components/ui/animated-button";
import { Input } from "@/components/ui/input";

export function UrlQuickstart() {
  const router = useRouter();
  const [urlInput, setUrlInput] = React.useState("https://example.com/pricing");
  const [error, setError] = React.useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateTargetUrl(urlInput);
    if (!result.valid || !result.normalizedUrl) {
      setError(result.reason ?? "Enter a valid public website URL.");
      return;
    }
    setError(null);
    router.push(
      `/dashboard/monitors/new?url=${encodeURIComponent(result.normalizedUrl)}`
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="quickstart-url" className="sr-only">
          Website URL to monitor
        </label>
        <Input
          id="quickstart-url"
          type="url"
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value);
            if (error) setError(null);
          }}
          placeholder="https://status.vendor.com"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "quickstart-url-error" : "quickstart-url-hint"}
          className="h-10 font-mono text-sm sm:flex-1"
        />
        <AnimatedButton type="submit" className="h-10 shrink-0 px-5">
          <span>Prepare Monitor</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </AnimatedButton>
      </div>

      {error ? (
        <p
          id="quickstart-url-error"
          role="alert"
          className="flex items-center gap-1.5 text-xs text-destructive"
        >
          <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : (
        <p id="quickstart-url-hint" className="text-xs text-muted-foreground">
          Try entering <code className="font-mono">http://127.0.0.1</code> or{" "}
          <code className="font-mono">file:///</code> to test client SSRF pre-validation.
        </p>
      )}
    </form>
  );
}
