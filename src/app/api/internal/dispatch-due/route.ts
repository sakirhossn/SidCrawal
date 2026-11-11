import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseValidatedJson } from "@/lib/auth/http";
import { executeAndPersistMonitorCrawl } from "@/lib/crawler/run-monitor-crawl";
import type { CrawlJobDispatchItem } from "@/lib/crawler/types";
import { getWorkerEndpoint } from "@/lib/preview/worker-client";
import {
  isConfiguredSecret,
  verifyBearerSecret,
} from "@/lib/security/internal-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const dispatchBodySchema = z
  .object({
    limit: z.number().int().min(1).max(25).default(10),
    workerId: z.string().trim().max(80).default("cloudflare-cron"),
    mode: z.enum(["auto", "github", "worker"]).default("auto"),
  })
  .default({ limit: 10, workerId: "cloudflare-cron", mode: "auto" });

async function triggerGithubWorkflowDispatch(batchLimit: number): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const workflowId =
    process.env.GITHUB_CRAWLER_WORKFLOW_ID?.trim() || "crawler-worker.yml";

  if (
    !isConfiguredSecret(token) ||
    !isConfiguredSecret(owner) ||
    !isConfiguredSecret(repo)
  ) {
    return false;
  }

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "SidCrawal-Scheduler/1.0",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          batch_limit: String(batchLimit),
        },
      }),
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub dispatch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  return true;
}

export async function POST(request: Request) {
  if (
    !verifyBearerSecret(
      request.headers.get("authorization"),
      process.env.CLOUDFLARE_DISPATCH_SECRET
    )
  ) {
    return jsonError(
      "UNAUTHORIZED_DISPATCHER",
      "Invalid or missing dispatcher authorization token.",
      401
    );
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return jsonError(
      "SUPABASE_ADMIN_UNCONFIGURED",
      "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required.",
      503
    );
  }

  let bodyInput: z.infer<typeof dispatchBodySchema> = {
    limit: 10,
    workerId: "cloudflare-cron",
    mode: "auto",
  };
  const contentLen = request.headers.get("content-length");
  if (contentLen && Number(contentLen) > 0) {
    const parsed = await parseValidatedJson(request, dispatchBodySchema);
    if ("response" in parsed) {
      return parsed.response;
    }
    bodyInput = parsed.data;
  }

  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc(
    "claim_due_crawl_jobs",
    {
      p_limit: bodyInput.limit,
      p_worker_id: bodyInput.workerId,
    }
  );

  if (claimError) {
    return jsonError("DISPATCH_CLAIM_FAILED", claimError.message, 500);
  }

  const jobs = (claimedRows ?? []) as CrawlJobDispatchItem[];
  if (jobs.length === 0) {
    return NextResponse.json({
      ok: true,
      claimed: 0,
      dispatchedVia: "none",
      results: [],
    });
  }

  const hasGithub =
    isConfiguredSecret(process.env.GITHUB_DISPATCH_TOKEN) &&
    isConfiguredSecret(process.env.GITHUB_REPO_OWNER) &&
    isConfiguredSecret(process.env.GITHUB_REPO_NAME);

  if (bodyInput.mode === "github" || (bodyInput.mode === "auto" && hasGithub)) {
    try {
      await triggerGithubWorkflowDispatch(jobs.length);
      return NextResponse.json({
        ok: true,
        claimed: jobs.length,
        dispatchedVia: "github_actions",
        jobIds: jobs.map((j) => j.job_id),
      });
    } catch (err) {
      // Release claimed jobs cleanly on dispatch failure so they remain eligible
      await supabaseAdmin
        .from("crawl_jobs")
        .update({ state: "backoff", locked_at: null, locked_by: null })
        .in(
          "id",
          jobs.map((j) => j.job_id)
        );
      return jsonError(
        "GITHUB_DISPATCH_FAILED",
        err instanceof Error ? err.message : "Failed triggering GitHub workflow.",
        502
      );
    }
  }

  const workerEndpoint = getWorkerEndpoint();
  if (!workerEndpoint) {
    return NextResponse.json({
      ok: true,
      claimed: jobs.length,
      dispatchedVia: "queued_for_batch_worker",
      jobIds: jobs.map((j) => j.job_id),
    });
  }

  // Fallback HTTP execution directly against configured Playwright worker service
  const results = [];
  for (const job of jobs) {
    const { persisted } = await executeAndPersistMonitorCrawl(supabaseAdmin, job);
    results.push({
      monitorId: job.monitor_id,
      outcome: persisted.outcome,
      crawlRunId: persisted.crawlRunId,
      detectedChangeId: persisted.detectedChangeId,
    });
  }

  return NextResponse.json({
    ok: true,
    claimed: jobs.length,
    dispatchedVia: "browser_worker_http",
    results,
  });
}
