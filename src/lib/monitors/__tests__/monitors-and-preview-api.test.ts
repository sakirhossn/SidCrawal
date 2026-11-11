import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireVerifiedSession = vi.fn();
const mockValidateDns = vi.fn();
const mockWorkerRender = vi.fn();
const mockIsSupabaseConfigured = vi.fn();

vi.mock("@/lib/monitors/auth-guard", () => ({
  requireVerifiedMonitorSession: () => mockRequireVerifiedSession(),
}));

vi.mock("@/lib/security/ssrf", () => ({
  validatePublicTargetWithDns: (url: string) => mockValidateDns(url),
}));

vi.mock("@/lib/supabase/env", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/env")>(
    "@/lib/supabase/env"
  );
  return {
    ...actual,
    isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  };
});

vi.mock("@/lib/preview/worker-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/preview/worker-client")>(
    "@/lib/preview/worker-client"
  );
  return {
    ...actual,
    requestWorkerPreviewRender: (input: unknown) => mockWorkerRender(input),
  };
});

import { POST as previewRenderPost } from "@/app/api/preview/render/route";
import { GET as monitorsGet, POST as monitorsPost } from "@/app/api/monitors/route";
import { PATCH as monitorPatch } from "@/app/api/monitors/[id]/route";
import { PUT as selectionPut } from "@/app/api/monitors/[id]/selection/route";
import { WorkerClientError } from "@/lib/preview/worker-client";

function jsonReq(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Preview Render & Monitors API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(false);
  });

  it("blocks SSRF target in /api/preview/render with 403", async () => {
    mockValidateDns.mockResolvedValue({
      ok: false,
      code: "SSRF_BLOCKED_TARGET",
      reason: "Private IP range blocked.",
    });

    const res = await previewRenderPost(
      jsonReq("http://localhost:3000/api/preview/render", {
        url: "http://169.254.169.254/latest/meta-data/",
      })
    );
    expect(res.status).toBe(403);
    expect(mockWorkerRender).not.toHaveBeenCalled();
  });

  it("forwards BLOCKED_BY_CHALLENGE (422) and WORKER_TIMEOUT (504) cleanly", async () => {
    mockValidateDns.mockResolvedValue({
      ok: true,
      normalizedUrl: "https://protected.example/",
      host: "protected.example",
    });

    mockWorkerRender.mockRejectedValueOnce(
      new WorkerClientError("BLOCKED_BY_CHALLENGE", "CAPTCHA detected", 422)
    );
    const blockedRes = await previewRenderPost(
      jsonReq("http://localhost:3000/api/preview/render", {
        url: "https://protected.example/",
      })
    );
    expect(blockedRes.status).toBe(422);

    mockWorkerRender.mockRejectedValueOnce(
      new WorkerClientError("WORKER_TIMEOUT", "Timed out", 504)
    );
    const timeoutRes = await previewRenderPost(
      jsonReq("http://localhost:3000/api/preview/render", {
        url: "https://protected.example/",
      })
    );
    expect(timeoutRes.status).toBe(504);
  });

  it("returns preview payload on successful render", async () => {
    mockValidateDns.mockResolvedValue({
      ok: true,
      normalizedUrl: "https://github.com/pricing",
      host: "github.com",
    });
    mockWorkerRender.mockResolvedValue({
      previewId: "p-1",
      finalUrl: "https://github.com/pricing",
      pageTitle: "Pricing · Plans for every developer · GitHub",
      httpStatus: 200,
      resolvedIp: "140.82.121.4",
      frameBlockedByHeader: true,
      framePolicyHeader: "X-Frame-Options: deny",
      viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
      documentDimensions: { width: 1280, height: 1800 },
      screenshotDataUrl: "data:image/png;base64,AAAA",
      elements: [],
    });

    const res = await previewRenderPost(
      jsonReq("http://localhost:3000/api/preview/render", {
        url: "https://github.com/pricing",
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.frameBlockedByHeader).toBe(true);
  });

  it("creates monitor, enforces quotas, saves selection, and activates monitor", async () => {
    const monitorsTable = {
      id: "mon-1",
      name: "GitHub Pricing",
      url: "https://github.com/pricing",
      normalized_host: "github.com",
      status: "draft",
      check_interval_minutes: 60,
    };

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "usage_limits") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { max_monitors: 5, min_interval_minutes: 60 },
                }),
              }),
            }),
          };
        }
        if (table === "monitors") {
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return {
                  eq: async () => ({ count: 1 }),
                };
              }
              return {
                order: async () => ({ data: [monitorsTable], error: null }),
                eq: () => ({
                  maybeSingle: async () => ({ data: monitorsTable, error: null }),
                }),
              };
            },
            insert: () => ({
              select: () => ({
                single: async () => ({ data: monitorsTable, error: null }),
              }),
            }),
            update: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: { ...monitorsTable, status: "active" },
                    error: null,
                  }),
                }),
                then: (resolve: (val: { error: null }) => void) =>
                  resolve({ error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ count: 0 }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "sel-1",
                  monitor_id: "mon-1",
                  selection_type: "element",
                  css_selector: "h1",
                },
                error: null,
              }),
            }),
          }),
        };
      }),
    };

    mockRequireVerifiedSession.mockResolvedValue({
      supabase: mockSupabase,
      user: { id: "user-1" },
    });
    mockValidateDns.mockResolvedValue({
      ok: true,
      normalizedUrl: "https://github.com/pricing",
      host: "github.com",
    });

    const listRes = await monitorsGet();
    expect(listRes.status).toBe(200);

    const createRes = await monitorsPost(
      jsonReq("http://localhost:3000/api/monitors", {
        name: "GitHub Pricing",
        url: "https://github.com/pricing",
        checkIntervalMinutes: 60,
      })
    );
    expect(createRes.status).toBe(201);

    // Activating without saved selection should fail cleanly
    const patchFail = await monitorPatch(
      jsonReq(
        "http://localhost:3000/api/monitors/mon-1",
        { status: "active" },
        "PATCH"
      ),
      { params: Promise.resolve({ id: "mon-1" }) }
    );
    expect(patchFail.status).toBe(400);

    // Save selection + activate
    const selRes = await selectionPut(
      jsonReq(
        "http://localhost:3000/api/monitors/mon-1/selection",
        {
          selectionType: "element",
          cssSelector: "h1",
          selectors: ["h1"],
          elementMetadata: { tag: "h1" },
          boundingBox: { x: 40, y: 80, width: 320, height: 48 },
          viewportDimensions: { width: 1280, height: 800, deviceScaleFactor: 1 },
          selectedText: "Plans for every developer",
          normalizationRules: { collapseWhitespace: true, ignoreNumbers: false },
          activate: true,
        },
        "PUT"
      ),
      { params: Promise.resolve({ id: "mon-1" }) }
    );
    expect(selRes.status).toBe(200);
    const selJson = await selRes.json();
    expect(selJson.monitorStatus).toBe("active");
  });
});
