import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockAdminClient = vi.fn();
const mockRunCrawl = vi.fn();
const mockPersistResult = vi.fn();

vi.mock("@/lib/monitors/auth-guard", () => ({
  requireVerifiedMonitorSession: () => mockRequireSession(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockAdminClient(),
}));

vi.mock("@/lib/crawler/run-monitor-crawl", () => ({
  executeAndPersistMonitorCrawl: (db: unknown, job: unknown) =>
    mockRunCrawl(db, job),
}));

vi.mock("@/lib/crawler/persist-run", () => ({
  persistCrawlExecutionResult: (db: unknown, params: unknown) =>
    mockPersistResult(db, params),
}));

import { POST as dispatchPost } from "@/app/api/internal/dispatch-due/route";
import { POST as crawlResultsPost } from "@/app/api/internal/crawl-results/route";
import { POST as manualCrawlPost } from "@/app/api/monitors/[id]/crawl/route";
import { GET as signedUrlGet } from "@/app/api/snapshots/[id]/signed-url/route";

describe("Phase 4 internal dispatch, callback, crawl trigger & signed URL APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLOUDFLARE_DISPATCH_SECRET = "test-dispatch-secret";
    process.env.BROWSER_WORKER_SECRET = "test-worker-secret";
    delete process.env.GITHUB_DISPATCH_TOKEN;
  });

  it("rejects unauthorized internal dispatch & callback requests cleanly", async () => {
    const res1 = await dispatchPost(
      new Request("http://localhost:3000/api/internal/dispatch-due", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      })
    );
    expect(res1.status).toBe(401);

    const res2 = await crawlResultsPost(
      new Request("http://localhost:3000/api/internal/crawl-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res2.status).toBe(401);
  });

  it("claims due jobs in dispatch-due and runs via fallback HTTP worker", async () => {
    mockAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            job_id: "job-1",
            monitor_id: "mon-1",
            user_id: "usr-1",
            url: "https://example.com",
            monitor_name: "Example",
            check_interval_minutes: 60,
            consecutive_failures: 0,
            active_baseline_snapshot_id: null,
            trigger_source: "baseline",
            selection_id: "sel-1",
            selection_type: "element",
            css_selector: "h1",
            selectors_json: ["h1"],
            bounding_box: { x: 0, y: 0, width: 100, height: 30 },
            viewport_dimensions: { width: 1280, height: 800, deviceScaleFactor: 1 },
            normalization_rules: {},
          },
        ],
        error: null,
      }),
    });
    mockRunCrawl.mockResolvedValue({
      crawlResult: { ok: true },
      persisted: {
        crawlRunId: "run-1",
        outcome: "baseline_created",
        detectedChangeId: null,
      },
    });

    const res = await dispatchPost(
      new Request("http://localhost:3000/api/internal/dispatch-due", {
        method: "POST",
        headers: { Authorization: "Bearer test-dispatch-secret" },
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.claimed).toBe(1);
    expect(json.dispatchedVia).toBe("browser_worker_http");
    expect(json.results[0].outcome).toBe("baseline_created");
  });

  it("triggers manual monitor crawl under verified session and persists result", async () => {
    mockAdminClient.mockReturnValue({});
    const makeTableMock = (table: string) => ({
      select: () => makeTableMock(table),
      eq: () => makeTableMock(table),
      order: () => makeTableMock(table),
      limit: () => makeTableMock(table),
      maybeSingle: async () => {
        if (table === "monitors") {
          return {
            data: {
              id: "mon-1",
              user_id: "usr-1",
              name: "Test",
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
              bounding_box: { x: 10, y: 10, width: 100, height: 24 },
              viewport_dimensions: { width: 1280, height: 800, deviceScaleFactor: 1 },
              normalization_rules: {},
            },
            error: null,
          };
        }
        if (table === "usage_limits") {
          return {
            data: {
              max_monthly_crawls: 2000,
              current_month_crawls: 3,
              quota_reset_at: new Date(Date.now() + 86_400_000).toISOString(),
            },
            error: null,
          };
        }
        return { data: { id: "job-1", state: "idle", consecutive_failures: 0 }, error: null };
      },
    });

    mockRequireSession.mockResolvedValue({
      supabase: { from: makeTableMock },
      user: { id: "usr-1", email: "owner@example.com" },
    });
    mockRunCrawl.mockResolvedValue({
      crawlResult: { ok: true },
      persisted: { crawlRunId: "run-9", outcome: "baseline_created" },
    });

    const res = await manualCrawlPost(
      new Request("http://localhost:3000/api/monitors/mon-1/crawl", { method: "POST" }),
      { params: Promise.resolve({ id: "mon-1" }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.persistence.outcome).toBe("baseline_created");
  });

  it("validates variant and generates signed Storage URL for RLS-owned snapshot", async () => {
    const badRes = await signedUrlGet(
      new Request("http://localhost:3000/api/snapshots/snap-1/signed-url?variant=raw"),
      { params: Promise.resolve({ id: "snap-1" }) }
    );
    expect(badRes.status).toBe(400);

    mockAdminClient.mockReturnValue(null);
    mockRequireSession.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "snap-1",
                  element_screenshot_path: "usr-1/mon-1/run-1/element.png",
                  full_page_screenshot_path: "usr-1/mon-1/run-1/full.png",
                },
                error: null,
              }),
            }),
          }),
        }),
        storage: {
          from: () => ({
            createSignedUrl: async (path: string) => ({
              data: { signedUrl: `https://storage.local/sign/${path}?token=abc` },
              error: null,
            }),
          }),
        },
      },
      user: { id: "usr-1" },
    });

    const okRes = await signedUrlGet(
      new Request(
        "http://localhost:3000/api/snapshots/snap-1/signed-url?variant=element"
      ),
      { params: Promise.resolve({ id: "snap-1" }) }
    );
    const okJson = await okRes.json();

    expect(okRes.status).toBe(200);
    expect(okJson.signedUrl).toContain("usr-1/mon-1/run-1/element.png");
  });
});
