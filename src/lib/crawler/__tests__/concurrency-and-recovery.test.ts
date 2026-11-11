import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserConcurrencyLimiter,
  ConcurrencyLimitError,
} from "../../../../worker/src/concurrency";

const { mockRequireSession, mockAdminClient, mockRunCrawl } = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockAdminClient: vi.fn(),
  mockRunCrawl: vi.fn(),
}));

vi.mock("@/lib/monitors/auth-guard", () => ({
  requireVerifiedMonitorSession: mockRequireSession,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockAdminClient,
}));

vi.mock("@/lib/crawler/run-monitor-crawl", () => ({
  executeAndPersistMonitorCrawl: mockRunCrawl,
}));

vi.mock("@/lib/telemetry/api-errors", () => ({
  recordApiErrorEvent: vi.fn(),
}));

import { POST as manualCrawlPost } from "@/app/api/monitors/[id]/crawl/route";
import { resetInMemoryRateLimits } from "@/lib/security/rate-limit";

function deferred<T = void>() {
  let resolve!: (val: T) => void;
  let reject!: (err?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Phase 6 worker concurrency, duplicate guards & per-user quotas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryRateLimits();
  });

  it("caps parallel browser tasks, queues overflow cleanly, and rejects when queue is full", async () => {
    const limiter = new BrowserConcurrencyLimiter({
      maxConcurrent: 2,
      maxQueueSize: 1,
    });

    const d1 = deferred();
    const d2 = deferred();
    const d3 = deferred();

    const p1 = limiter.run(() => d1.promise);
    const p2 = limiter.run(() => d2.promise);
    expect(limiter.getMetrics()).toEqual({
      activeBrowsers: 2,
      queuedRequests: 0,
      maxConcurrent: 2,
      maxQueueSize: 1,
    });

    let p3Started = false;
    const p3 = limiter.run(async () => {
      p3Started = true;
      await d3.promise;
    });

    expect(limiter.getMetrics().queuedRequests).toBe(1);
    expect(p3Started).toBe(false);

    await expect(limiter.run(async () => "overflow")).rejects.toMatchObject({
      code: "WORKER_QUEUE_FULL",
      statusCode: 503,
    } satisfies Partial<ConcurrencyLimitError>);

    d1.resolve();
    await p1;
    // Allow microtask queue to wake waiting p3
    await Promise.resolve();
    expect(p3Started).toBe(true);

    d2.resolve();
    d3.resolve();
    await Promise.all([p2, p3]);
    expect(limiter.getMetrics().activeBrowsers).toBe(0);
    expect(limiter.getMetrics().queuedRequests).toBe(0);
  });

  it("times out queued requests when browser slots remain saturated", async () => {
    const limiter = new BrowserConcurrencyLimiter({
      maxConcurrent: 1,
      maxQueueSize: 2,
    });

    const hold = deferred();
    const first = limiter.run(() => hold.promise);

    await expect(limiter.run(async () => "never", 25)).rejects.toMatchObject({
      code: "WORKER_CONCURRENCY_TIMEOUT",
      statusCode: 503,
    });

    hold.resolve();
    await first;
  });

  it("blocks duplicate queued crawls and enforces per-user max_concurrent_jobs quota", async () => {
    const makeRlsMock = (jobState: string, maxConcurrentJobs = 2) => (table: string) => ({
      select: () => makeRlsMock(jobState, maxConcurrentJobs)(table),
      eq: () => makeRlsMock(jobState, maxConcurrentJobs)(table),
      order: () => makeRlsMock(jobState, maxConcurrentJobs)(table),
      limit: () => makeRlsMock(jobState, maxConcurrentJobs)(table),
      maybeSingle: async () => {
        if (table === "monitors") {
          return {
            data: {
              id: "mon-1",
              user_id: "usr-1",
              name: "Pricing",
              url: "https://example.com",
              status: "active",
              check_interval_minutes: 60,
              active_baseline_snapshot_id: null,
            },
            error: null,
          };
        }
        if (table === "monitor_selections") {
          return {
            data: {
              id: "sel-1",
              selection_type: "element",
              css_selector: "h1",
              selectors_json: ["h1"],
              bounding_box: { x: 0, y: 0, width: 100, height: 20 },
              viewport_dimensions: { width: 1280, height: 800, deviceScaleFactor: 1 },
              normalization_rules: {},
            },
            error: null,
          };
        }
        if (table === "usage_limits") {
          return {
            data: {
              max_monthly_crawls: 1000,
              current_month_crawls: 0,
              quota_reset_at: new Date(Date.now() + 86_400_000).toISOString(),
              max_concurrent_jobs: maxConcurrentJobs,
            },
            error: null,
          };
        }
        return {
          data: { id: "job-1", state: jobState, consecutive_failures: 0 },
          error: null,
        };
      },
    });

    mockAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ count: 2, error: null }),
          }),
        }),
      }),
    });

    // 1. Duplicate queued job -> 409
    mockRequireSession.mockResolvedValueOnce({
      supabase: { from: makeRlsMock("queued") },
      user: { id: "usr-1", email: "user@example.com" },
    });

    const dupRes = await manualCrawlPost(
      new Request("https://sidcrawal.app/api/monitors/mon-1/crawl", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.77" },
      }),
      { params: Promise.resolve({ id: "mon-1" }) }
    );
    expect(dupRes.status).toBe(409);
    const dupJson = await dupRes.json();
    expect(dupJson.error.code).toBe("CRAWL_ALREADY_RUNNING");

    // 2. Idle monitor, but user already has 2 running/queued crawls matching quota -> 429
    mockRequireSession.mockResolvedValueOnce({
      supabase: { from: makeRlsMock("idle", 2) },
      user: { id: "usr-1", email: "user@example.com" },
    });

    const quotaRes = await manualCrawlPost(
      new Request("https://sidcrawal.app/api/monitors/mon-1/crawl", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.78" },
      }),
      { params: Promise.resolve({ id: "mon-1" }) }
    );
    expect(quotaRes.status).toBe(429);
    const quotaJson = await quotaRes.json();
    expect(quotaJson.error.code).toBe("CONCURRENT_CRAWL_LIMIT_REACHED");
    expect(mockRunCrawl).not.toHaveBeenCalled();
  });
});
