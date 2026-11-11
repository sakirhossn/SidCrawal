import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PLACEHOLDER_TOKENS = ["placeholder", "your-"];

function isConfiguredValue(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  return !PLACEHOLDER_TOKENS.some((token) => trimmed.includes(token));
}

async function main() {
  const root = process.cwd();
  const requiredArtifacts = [
    "package.json",
    "next.config.ts",
    "supabase/migrations/0001_initial_schema.sql",
    "supabase/migrations/0002_rls_and_storage.sql",
    "supabase/migrations/0003_monitor_activation_trigger.sql",
    "supabase/migrations/0004_crawler_scheduling_and_rpcs.sql",
    "supabase/migrations/0005_phase6_concurrency_and_telemetry.sql",
    "cloudflare/wrangler.toml",
    "cloudflare/src/index.ts",
    ".github/workflows/crawler-worker.yml",
    "worker/src/server.ts",
    "worker/src/concurrency.ts",
    "worker/src/batch.ts",
  ];

  const missingArtifacts = requiredArtifacts.filter(
    (rel) => !fs.existsSync(path.join(root, rel))
  );

  const envVars = {
    NEXT_PUBLIC_APP_URL: isConfiguredValue(process.env.NEXT_PUBLIC_APP_URL),
    NEXT_PUBLIC_SUPABASE_URL: isConfiguredValue(
      process.env.NEXT_PUBLIC_SUPABASE_URL
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: isConfiguredValue(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    SUPABASE_SERVICE_ROLE_KEY: isConfiguredValue(
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
    BROWSER_WORKER_URL: isConfiguredValue(process.env.BROWSER_WORKER_URL),
    BROWSER_WORKER_SECRET: isConfiguredValue(process.env.BROWSER_WORKER_SECRET),
    CLOUDFLARE_DISPATCH_SECRET: isConfiguredValue(
      process.env.CLOUDFLARE_DISPATCH_SECRET
    ),
    GITHUB_DISPATCH_TOKEN: isConfiguredValue(process.env.GITHUB_DISPATCH_TOKEN),
    GITHUB_REPO_OWNER: isConfiguredValue(process.env.GITHUB_REPO_OWNER),
    GITHUB_REPO_NAME: isConfiguredValue(process.env.GITHUB_REPO_NAME),
    GITHUB_CRAWLER_WORKFLOW_ID: isConfiguredValue(
      process.env.GITHUB_CRAWLER_WORKFLOW_ID
    ),
    RESEND_API_KEY: isConfiguredValue(process.env.RESEND_API_KEY),
    EMAIL_FROM: isConfiguredValue(process.env.EMAIL_FROM),
    UPSTASH_REDIS_REST_URL: isConfiguredValue(process.env.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: isConfiguredValue(
      process.env.UPSTASH_REDIS_REST_TOKEN
    ),
  };

  let appUrlKind: "missing" | "local" | "public_https" = "missing";
  if (envVars.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL) {
    try {
      const parsed = new URL(process.env.NEXT_PUBLIC_APP_URL.trim());
      const isLocal =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname.endsWith(".local");
      appUrlKind =
        !isLocal && parsed.protocol === "https:" ? "public_https" : "local";
    } catch {
      appUrlKind = "missing";
    }
  }

  let supabaseLive = {
    checked: false,
    reachable: false,
    schemaReady: false,
    storageBucketReady: false,
    note: "Skipped because Supabase URL or service role key uses placeholder values.",
  };

  if (
    envVars.NEXT_PUBLIC_SUPABASE_URL &&
    envVars.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    try {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL.trim(),
        process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { error: schemaErr } = await admin
        .from("api_error_events")
        .select("id", { count: "exact", head: true });
      const { data: bucketData, error: bucketErr } =
        await admin.storage.getBucket("monitor-snapshots");

      supabaseLive = {
        checked: true,
        reachable: true,
        schemaReady: !schemaErr,
        storageBucketReady: !bucketErr && Boolean(bucketData),
        note: schemaErr
          ? `Connected, but schema check failed: ${schemaErr.message}`
          : !bucketErr && bucketData
            ? "Connected; migrations (including 0005) and monitor-snapshots bucket verified."
            : `Connected; bucket check: ${bucketErr?.message ?? "missing monitor-snapshots"}`,
      };
    } catch (err) {
      supabaseLive = {
        checked: true,
        reachable: false,
        schemaReady: false,
        storageBucketReady: false,
        note: err instanceof Error ? err.message : "Supabase probe failed.",
      };
    }
  }

  let workerLive = {
    checked: false,
    reachable: false,
    chromiumAvailable: false,
    note: "Skipped because BROWSER_WORKER_URL is unset.",
  };

  if (envVars.BROWSER_WORKER_URL && process.env.BROWSER_WORKER_URL) {
    try {
      const target = `${process.env.BROWSER_WORKER_URL.trim().replace(/\/+$/, "")}/health`;
      const res = await fetch(target, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const body = (await res.json()) as {
          ok?: boolean;
          chromiumAvailable?: boolean;
        };
        workerLive = {
          checked: true,
          reachable: true,
          chromiumAvailable: Boolean(body.chromiumAvailable),
          note: `Worker healthy (${new URL(target).origin}).`,
        };
      } else {
        workerLive = {
          checked: true,
          reachable: true,
          chromiumAvailable: false,
          note: `Worker responded with HTTP ${res.status}.`,
        };
      }
    } catch (err) {
      workerLive = {
        checked: true,
        reachable: false,
        chromiumAvailable: false,
        note: err instanceof Error ? err.message : "Worker unreachable.",
      };
    }
  }

  const report = {
    artifactsComplete: missingArtifacts.length === 0,
    missingArtifacts,
    appUrlKind,
    envConfigured: envVars,
    pendingEnvKeys: Object.entries(envVars)
      .filter(([, ok]) => !ok)
      .map(([k]) => k),
    checks: {
      supabaseLive,
      workerLive,
      resendConfigured: envVars.RESEND_API_KEY && envVars.EMAIL_FROM,
      upstashConfigured:
        envVars.UPSTASH_REDIS_REST_URL && envVars.UPSTASH_REDIS_REST_TOKEN,
      cloudflareConfigured:
        appUrlKind === "public_https" && envVars.CLOUDFLARE_DISPATCH_SECRET,
      githubActionsConfigured:
        envVars.GITHUB_DISPATCH_TOKEN &&
        envVars.GITHUB_REPO_OWNER &&
        envVars.GITHUB_REPO_NAME &&
        envVars.GITHUB_CRAWLER_WORKFLOW_ID,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("[verify:prod] error:", err);
  process.exit(1);
});
