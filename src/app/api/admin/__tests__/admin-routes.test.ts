import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockServerClient, mockAdminClient } = vi.hoisted(() => ({
  mockServerClient: vi.fn(),
  mockAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mockServerClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockAdminClient,
}));

import { GET as overviewGet } from "@/app/api/admin/overview/route";
import { POST as recoverJobsPost } from "@/app/api/admin/recover-jobs/route";
import { resetInMemoryRateLimits } from "@/lib/security/rate-limit";
import { recordApiErrorEvent } from "@/lib/telemetry/api-errors";

function createQueryStub(options: {
  countByTable: Record<string, number>;
  rowsByTable?: Record<string, unknown[]>;
}) {
  return (table: string) => {
    let headMode = false;
    const filters: Array<[string, unknown]> = [];

    const builder: Record<string, unknown> = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        headMode = Boolean(opts?.head);
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([`${col}=${String(val)}`, val]);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push([`${col} in (${vals.join(",")})`, vals]);
        return builder;
      },
      gte(col: string) {
        filters.push([`${col}>=`, true]);
        return builder;
      },
      lte(col: string) {
        filters.push([`${col}<=`, true]);
        return builder;
      },
      lt(col: string) {
        filters.push([`${col}<`, true]);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return Promise.resolve({
          data: options.rowsByTable?.[table] ?? [],
          error: null,
        });
      },
      then(resolve: (val: unknown) => void) {
        if (headMode) {
          const key = `${table}:${filters.map((f) => f[0]).join("&")}`;
          const count =
            options.countByTable[key] ??
            options.countByTable[table] ??
            0;
          resolve({ count, error: null });
          return;
        }
        resolve({ data: options.rowsByTable?.[table] ?? [], error: null });
      },
    };
    return builder;
  };
}

describe("Admin operational telemetry & recovery endpoints", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryRateLimits();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("blocks unauthenticated and non-admin users with 401/403", async () => {
    mockServerClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const unauth = await overviewGet(
      new Request("https://sidcrawal.app/api/admin/overview")
    );
    expect(unauth.status).toBe(401);

    mockServerClient.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({
          data: { user: { id: "usr-std", email: "user@example.com" } },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role: "user" }, error: null }),
          }),
        }),
      }),
    });

    const forbidden = await overviewGet(
      new Request("https://sidcrawal.app/api/admin/overview")
    );
    expect(forbidden.status).toBe(403);
    const body = await forbidden.json();
    expect(body.error.code).toBe("ADMIN_FORBIDDEN");
  });

  it("returns real DB counts and live worker health to verified admins", async () => {
    mockServerClient.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({
          data: { user: { id: "usr-adm", email: "admin@example.com" } },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role: "admin" }, error: null }),
          }),
        }),
      }),
    });

    mockAdminClient.mockReturnValue({
      from: createQueryStub({
        countByTable: {
          profiles: 14,
          monitors: 28,
          "monitors:status=active": 21,
          crawl_jobs: 21,
          "crawl_jobs:state=idle&next_run_at<=": 3,
          "crawl_jobs:state in (idle,backoff)&next_run_at<=": 4,
          "crawl_jobs:state in (queued,running)&locked_at<": 1,
          crawl_runs: 190,
          "crawl_runs:status=succeeded": 182,
          "crawl_runs:status=failed": 6,
          "crawl_runs:status=blocked": 1,
          "crawl_runs:status=timeout": 1,
          detected_changes: 47,
          "detected_changes:detected_at>=": 5,
          notifications: 47,
          "notifications:status=sent": 45,
          "notifications:status=failed": 1,
          "notifications:status=suppressed_duplicate": 1,
          "api_error_events:created_at>=": 2,
        },
        rowsByTable: {
          api_error_events: [
            {
              id: "err-1",
              route: "/api/auth/login",
              method: "POST",
              status_code: 429,
              error_code: "RATE_LIMIT_EXCEEDED",
              message: "auth_login limit exceeded",
              created_at: "2026-11-11T09:00:00.000Z",
            },
          ],
        },
      }),
    });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          chromiumAvailable: true,
          concurrency: {
            activeBrowsers: 1,
            queuedRequests: 0,
            maxConcurrent: 2,
            maxQueueSize: 20,
          },
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const res = await overviewGet(
      new Request("https://sidcrawal.app/api/admin/overview")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.metrics.users.totalRegistered).toBe(14);
    expect(json.metrics.monitors.active).toBe(21);
    expect(json.metrics.crawlRuns.succeeded).toBe(182);
    expect(json.metrics.crawlRuns.failed).toBe(6);
    expect(json.metrics.notifications.sent).toBe(45);
    expect(json.metrics.crawlJobs.backlogDueNow).toBe(4);
    expect(json.metrics.crawlJobs.staleLockedCount).toBe(1);
    expect(json.metrics.worker.ok).toBe(true);
    expect(json.metrics.worker.concurrency.maxConcurrent).toBe(2);
    expect(json.metrics.apiErrors.recent[0].errorCode).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("recovers stale crawl jobs via admin RPC and logs non-blocking API errors", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: [{ recovered_job_id: "job-9", monitor_id: "mon-9", new_consecutive_failures: 1 }],
      error: null,
    });
    const mockInsert = vi.fn().mockRejectedValue(new Error("db offline"));

    mockServerClient.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({
          data: { user: { id: "usr-adm", email: "admin@example.com" } },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role: "admin" }, error: null }),
          }),
        }),
      }),
    });

    mockAdminClient.mockReturnValue({
      rpc: mockRpc,
      from: () => ({ insert: mockInsert }),
    });

    const recoverRes = await recoverJobsPost(
      new Request("https://sidcrawal.app/api/admin/recover-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staleMinutes: 15 }),
      })
    );
    expect(recoverRes.status).toBe(200);
    const recoverJson = await recoverRes.json();
    expect(recoverJson.recoveredCount).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith("recover_stale_crawl_jobs", {
      p_stale_minutes: 15,
    });

    await expect(
      recordApiErrorEvent({
        route: "/api/test",
        method: "POST",
        statusCode: 500,
        errorCode: "TEST_ERROR",
        message: "Should not throw",
      })
    ).resolves.toBeUndefined();
  });
});
