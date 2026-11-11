import { describe, expect, it } from "vitest";
import {
  buildTextDiffSummary,
  computeChangeFingerprint,
  sha256Hex,
} from "../fingerprint";
import {
  getVisualDiffThreshold,
  normalizeExtractedText,
} from "../normalization";
import { computeRetrySchedule } from "../retry";

describe("crawler normalization, fingerprinting, and retry policy", () => {
  it("normalizes dynamic numbers, timestamps, whitespace, and safe regexes", () => {
    const raw =
      "  Status: OK   at 2026-11-11T08:15:00Z (checked 3 minutes ago, token=abc999) — $49.00 ";

    const normalized = normalizeExtractedText(raw, {
      collapseWhitespace: true,
      stripTimestamps: true,
      ignoreNumbers: true,
      ignoreRegexPatterns: ["token=[a-z0-9]+", "[unclosed("],
    });

    expect(normalized).toBe(
      "Status: OK at [timestamp] (checked [relative-time], [ignored]) — $#.#"
    );
    expect(getVisualDiffThreshold({ visualDiffThresholdPercent: 1.25 })).toBe(1.25);
    expect(getVisualDiffThreshold({})).toBe(0.5);
  });

  it("computes deterministic change fingerprints and concise diff excerpts", () => {
    const hashA = sha256Hex("Pro Plan $29");
    const hashB = sha256Hex("Pro Plan $49");
    const fp1 = computeChangeFingerprint({
      monitorId: "mon-1",
      contentHash: hashB,
      changeType: "both",
      visualDiffPercentage: 4.4,
    });
    const fp2 = computeChangeFingerprint({
      monitorId: "mon-1",
      contentHash: hashB,
      changeType: "both",
      visualDiffPercentage: 4.1,
    });
    const fpDifferent = computeChangeFingerprint({
      monitorId: "mon-1",
      contentHash: hashA,
      changeType: "both",
      visualDiffPercentage: 4.4,
    });

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fpDifferent);

    const diff = buildTextDiffSummary("Pro Plan: $29 / mo", "Pro Plan: $49 / mo");
    expect(diff.changed).toBe(true);
    expect(diff.previousExcerpt).toContain("$29");
    expect(diff.currentExcerpt).toContain("$49");
  });

  it("schedules bounded exponential backoff retries while preserving baselines", () => {
    const now = new Date("2026-11-11T08:00:00.000Z");

    const r1 = computeRetrySchedule({
      outcome: "timeout",
      consecutiveFailures: 0,
      checkIntervalMinutes: 60,
      now,
    });
    expect(r1.preserveExistingBaseline).toBe(true);
    expect(r1.nextJobState).toBe("backoff");
    expect(r1.nextMonitorStatus).toBe("active");
    expect(r1.backoffMinutes).toBe(2);

    const r3 = computeRetrySchedule({
      outcome: "failed",
      consecutiveFailures: 2,
      checkIntervalMinutes: 60,
      now,
    });
    expect(r3.backoffMinutes).toBe(8);
    expect(r3.preserveExistingBaseline).toBe(true);

    const r5 = computeRetrySchedule({
      outcome: "failed",
      consecutiveFailures: 4,
      checkIntervalMinutes: 15,
      now,
    });
    expect(r5.nextMonitorStatus).toBe("error");
    expect(r5.nextJobState).toBe("backoff");
    expect(r5.backoffMinutes).toBe(30);
    expect(r5.preserveExistingBaseline).toBe(true);

    const blocked = computeRetrySchedule({
      outcome: "blocked",
      consecutiveFailures: 0,
      checkIntervalMinutes: 60,
      now,
    });
    expect(blocked.nextMonitorStatus).toBe("blocked");
    expect(blocked.nextJobState).toBe("paused");
    expect(blocked.preserveExistingBaseline).toBe(true);
  });
});
