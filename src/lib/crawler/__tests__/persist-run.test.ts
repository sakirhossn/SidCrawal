import { describe, expect, it } from "vitest";
import { sha256Hex } from "../fingerprint";
import {
  type AdminSupabaseLike,
  persistCrawlExecutionResult,
} from "../persist-run";
import type { WorkerCrawlResponse } from "../types";

interface MockDbState {
  monitor: {
    id: string;
    user_id: string;
    name: string;
    url: string;
    status: string;
    check_interval_minutes: number;
    active_baseline_snapshot_id: string | null;
    last_error_code: string | null;
    last_error_message: string | null;
    last_checked_at: string | null;
    last_changed_at: string | null;
  };
  crawlJob: {
    id: string;
    monitor_id: string;
    state: string;
    consecutive_failures: number;
    next_run_at: string;
    locked_at: string | null;
    locked_by: string | null;
  };
  crawlRuns: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown> & { id: string }>;
  detectedChanges: Array<Record<string, unknown> & { id: string }>;
  notifications: Array<Record<string, unknown> & { id: string }>;
  storageUploads: Array<{ bucket: string; path: string; bytes: number }>;
  rpcCalls: string[];
}

function createStatefulMockSupabase(state: MockDbState): AdminSupabaseLike {
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}-${seq++}`;

  const client = {
    from(table: string) {
      let mode: "select" | "insert" | "update" = "select";
      let payload: Record<string, unknown> = {};
      const filters: Array<{ op: "eq" | "gte"; col: string; val: string }> = [];

      const execute = async () => {
        if (table === "crawl_runs" && mode === "insert") {
          state.crawlRuns.push(payload);
          return { data: payload, error: null };
        }
        if (table === "snapshots" && mode === "insert") {
          const row = { id: nextId("snap"), ...payload };
          state.snapshots.push(row);
          return { data: row, error: null };
        }
        if (table === "snapshots" && mode === "select") {
          const idFilter = filters.find((f) => f.col === "id")?.val;
          const found = state.snapshots.find((s) => s.id === idFilter) ?? null;
          return { data: found, error: null };
        }
        if (table === "monitors" && mode === "update") {
          Object.assign(state.monitor, payload);
          return { data: state.monitor, error: null };
        }
        if (table === "crawl_jobs" && mode === "update") {
          Object.assign(state.crawlJob, payload);
          return { data: state.crawlJob, error: null };
        }
        if (table === "detected_changes" && mode === "insert") {
          const row = { id: nextId("chg"), ...payload };
          state.detectedChanges.push(row);
          return { data: row, error: null };
        }
        if (table === "detected_changes" && mode === "select") {
          const matches = state.detectedChanges.filter((c) =>
            filters.every((f) => {
              if (f.op === "eq") return String(c[f.col]) === f.val;
              return String(c[f.col]) >= f.val;
            })
          );
          return { data: matches[0] ?? null, error: null };
        }
        if (table === "profiles" && mode === "select") {
          return { data: { email: "owner@example.com" }, error: null };
        }
        if (table === "user_settings" && mode === "select") {
          return { data: { email_notifications_enabled: true }, error: null };
        }
        if (table === "notifications" && mode === "insert") {
          const row = { id: nextId("notif"), ...payload };
          state.notifications.push(row);
          return { data: row, error: null };
        }
        return { data: null, error: null };
      };

      const builder = {
        select() {
          return builder;
        },
        insert(values: Record<string, unknown>) {
          mode = "insert";
          payload = values;
          return builder;
        },
        update(values: Record<string, unknown>) {
          mode = "update";
          payload = values;
          return builder;
        },
        eq(col: string, val: string) {
          filters.push({ op: "eq", col, val });
          return builder;
        },
        gte(col: string, val: string) {
          filters.push({ op: "gte", col, val });
          return builder;
        },
        limit() {
          return builder;
        },
        single() {
          return execute();
        },
        maybeSingle() {
          return execute();
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return execute().then(onfulfilled, onrejected);
        },
      };

      return builder;
    },
    async rpc(fn: string) {
      state.rpcCalls.push(fn);
      return { error: null };
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, fileBody: Buffer) {
            state.storageUploads.push({
              bucket,
              path,
              bytes: fileBody.length,
            });
            return { error: null };
          },
        };
      },
    },
  };

  return client as unknown as AdminSupabaseLike;
}

function makeSuccessResult(text: string, opts?: Partial<WorkerCrawlResponse & { ok: true }>): WorkerCrawlResponse {
  return {
    ok: true,
    finalUrl: "https://example.com/pricing",
    pageTitle: "Pricing",
    httpStatus: 200,
    resolvedIp: "93.184.216.34",
    durationMs: 420,
    extractedHtml: `<p>${text}</p>`,
    extractedText: text,
    normalizedText: text,
    contentHash: sha256Hex(text),
    visualHash: sha256Hex(`img-${text}`),
    fullPagePngBase64: Buffer.from("full-png-bytes").toString("base64"),
    elementPngBase64: Buffer.from("elem-png-bytes").toString("base64"),
    diffPngBase64: null,
    visualDiffPercentage: 0,
    mismatchedPixels: 0,
    totalPixels: 1000,
    dimensionChanged: false,
    textChanged: false,
    visualChanged: false,
    hasMeaningfulChange: false,
    changeType: null,
    ...opts,
  };
}

describe("persistCrawlExecutionResult lifecycle", () => {
  it("creates baseline, preserves baseline on failure, detects changes, stores Storage PNGs, and deduplicates repeat transitions", async () => {
    const state: MockDbState = {
      monitor: {
        id: "mon-1",
        user_id: "usr-1",
        name: "Pricing Watch",
        url: "https://example.com/pricing",
        status: "active",
        check_interval_minutes: 60,
        active_baseline_snapshot_id: null,
        last_error_code: null,
        last_error_message: null,
        last_checked_at: null,
        last_changed_at: null,
      },
      crawlJob: {
        id: "job-1",
        monitor_id: "mon-1",
        state: "running",
        consecutive_failures: 0,
        next_run_at: new Date().toISOString(),
        locked_at: new Date().toISOString(),
        locked_by: "worker-1",
      },
      crawlRuns: [],
      snapshots: [],
      detectedChanges: [],
      notifications: [],
      storageUploads: [],
      rpcCalls: [],
    };

    const db = createStatefulMockSupabase(state);

    // 1. Initial baseline capture
    const baselineOut = await persistCrawlExecutionResult(db, {
      monitor: { ...state.monitor },
      jobId: state.crawlJob.id,
      consecutiveFailures: 0,
      triggerSource: "baseline",
      crawlResult: makeSuccessResult("Starter $19 / mo"),
    });

    expect(baselineOut.outcome).toBe("baseline_created");
    expect(state.monitor.active_baseline_snapshot_id).toBe("snap-1");
    expect(state.detectedChanges).toHaveLength(0);
    expect(state.storageUploads.map((u) => u.path)).toEqual([
      expect.stringMatching(/^usr-1\/mon-1\/.+\/full\.png$/),
      expect.stringMatching(/^usr-1\/mon-1\/.+\/element\.png$/),
    ]);

    // 2. Failed crawl NEVER overwrites valid baseline!
    const failedOut = await persistCrawlExecutionResult(db, {
      monitor: { ...state.monitor },
      jobId: state.crawlJob.id,
      consecutiveFailures: state.crawlJob.consecutive_failures,
      triggerSource: "scheduled",
      crawlResult: {
        ok: false,
        outcome: "timeout",
        errorCode: "WORKER_TIMEOUT",
        errorMessage: "Timed out after 20s",
        httpStatus: null,
        resolvedIp: null,
        durationMs: 20001,
      },
    });

    expect(failedOut.outcome).toBe("failed_baseline_preserved");
    expect(failedOut.preservedBaselineId).toBe("snap-1");
    expect(state.monitor.active_baseline_snapshot_id).toBe("snap-1");
    expect(state.crawlJob.state).toBe("backoff");
    expect(state.crawlJob.consecutive_failures).toBe(1);
    expect(state.monitor.last_error_code).toBe("WORKER_TIMEOUT");

    // 3. Recovery run with unchanged content preserves baseline & resets failure counter
    const unchangedOut = await persistCrawlExecutionResult(db, {
      monitor: { ...state.monitor },
      jobId: state.crawlJob.id,
      consecutiveFailures: state.crawlJob.consecutive_failures,
      triggerSource: "scheduled",
      crawlResult: makeSuccessResult("Starter $19 / mo"),
    });

    expect(unchangedOut.outcome).toBe("no_change");
    expect(state.monitor.active_baseline_snapshot_id).toBe("snap-1");
    expect(state.crawlJob.consecutive_failures).toBe(0);
    expect(state.crawlJob.state).toBe("idle");
    expect(state.monitor.last_error_code).toBeNull();

    // 4. Meaningful price change stores diff.png, promotes new baseline, and queues alert
    const changedOut = await persistCrawlExecutionResult(db, {
      monitor: { ...state.monitor },
      jobId: state.crawlJob.id,
      consecutiveFailures: 0,
      triggerSource: "scheduled",
      crawlResult: makeSuccessResult("Starter $29 / mo", {
        hasMeaningfulChange: true,
        textChanged: true,
        visualChanged: true,
        changeType: "both",
        visualDiffPercentage: 12.5,
        mismatchedPixels: 125,
        diffPngBase64: Buffer.from("diff-png-bytes").toString("base64"),
      }),
    });

    expect(changedOut.outcome).toBe("change_detected");
    expect(changedOut.notificationQueued).toBe(true);
    expect(state.detectedChanges).toHaveLength(1);
    expect(state.monitor.active_baseline_snapshot_id).toBe(changedOut.snapshotId);
    expect(state.storageUploads.some((u) => u.path.endsWith("/diff.png"))).toBe(true);
    expect(state.notifications[0]?.status).toBe("queued");

    // 5. Replaying same transition or oscillating within 24h suppresses duplicate notification
    const replayOut = await persistCrawlExecutionResult(db, {
      monitor: {
        ...state.monitor,
        active_baseline_snapshot_id: "snap-1",
      },
      jobId: state.crawlJob.id,
      consecutiveFailures: 0,
      triggerSource: "scheduled",
      crawlResult: makeSuccessResult("Starter $29 / mo", {
        hasMeaningfulChange: true,
        textChanged: true,
        visualChanged: true,
        changeType: "both",
        visualDiffPercentage: 12.5,
        mismatchedPixels: 125,
        diffPngBase64: Buffer.from("diff-png-bytes").toString("base64"),
      }),
    });

    expect(replayOut.deduplicated).toBe(true);
    expect(replayOut.notificationQueued).toBe(false);
    expect(state.detectedChanges).toHaveLength(1);
    expect(state.notifications).toHaveLength(1);
  });
});
