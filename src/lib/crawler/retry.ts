export type CrawlRunOutcome = "succeeded" | "failed" | "blocked" | "timeout";

export interface RetryScheduleDecision {
  nextMonitorStatus: "active" | "paused" | "error" | "blocked";
  nextJobState: "idle" | "backoff" | "paused";
  nextConsecutiveFailures: number;
  nextRunAtIso: string;
  backoffMinutes: number;
  preserveExistingBaseline: true;
}

/**
 * Computes safe retry/backoff scheduling after a crawl run.
 * Always preserves the existing valid baseline snapshot when a crawl fails, times out, or is blocked.
 */
export function computeRetrySchedule(input: {
  outcome: CrawlRunOutcome;
  consecutiveFailures: number;
  checkIntervalMinutes: number;
  now?: Date;
}): RetryScheduleDecision {
  const now = input.now ?? new Date();
  const interval = Math.max(5, Math.round(input.checkIntervalMinutes || 60));

  if (input.outcome === "succeeded") {
    const nextRun = new Date(now.getTime() + interval * 60_000);
    return {
      nextMonitorStatus: "active",
      nextJobState: "idle",
      nextConsecutiveFailures: 0,
      nextRunAtIso: nextRun.toISOString(),
      backoffMinutes: 0,
      preserveExistingBaseline: true,
    };
  }

  const nextFailures = Math.max(1, input.consecutiveFailures + 1);

  if (input.outcome === "blocked") {
    const nextRun = new Date(now.getTime() + interval * 60_000);
    return {
      nextMonitorStatus: "blocked",
      nextJobState: "paused",
      nextConsecutiveFailures: nextFailures,
      nextRunAtIso: nextRun.toISOString(),
      backoffMinutes: interval,
      preserveExistingBaseline: true,
    };
  }

  // Exponential backoff starting at 2 min (2, 4, 8, 16, 32...) capped by check interval until repeated failures
  const expMinutes = Math.pow(2, Math.min(nextFailures - 1, 4)) * 2;
  const backoffMinutes =
    nextFailures >= 5
      ? Math.max(interval, 30)
      : Math.min(interval, Math.max(2, expMinutes));

  const nextRun = new Date(now.getTime() + backoffMinutes * 60_000);

  if (nextFailures >= 10) {
    return {
      nextMonitorStatus: "error",
      nextJobState: "paused",
      nextConsecutiveFailures: nextFailures,
      nextRunAtIso: nextRun.toISOString(),
      backoffMinutes,
      preserveExistingBaseline: true,
    };
  }

  return {
    nextMonitorStatus: nextFailures >= 5 ? "error" : "active",
    nextJobState: "backoff",
    nextConsecutiveFailures: nextFailures,
    nextRunAtIso: nextRun.toISOString(),
    backoffMinutes,
    preserveExistingBaseline: true,
  };
}
