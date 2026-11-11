export class ConcurrencyLimitError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * FIFO semaphore bounding concurrent headless Chromium browser launches so bursts of
 * `/render` or `/crawl` calls cannot exhaust worker memory or CPU.
 */
export class BrowserConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options?: { maxConcurrent?: number; maxQueueSize?: number }) {
    const envMax = Number(process.env.WORKER_MAX_CONCURRENCY ?? "2");
    this.maxConcurrent = Math.min(
      Math.max(options?.maxConcurrent ?? (Number.isFinite(envMax) ? envMax : 2), 1),
      8
    );
    this.maxQueueSize = Math.max(options?.maxQueueSize ?? 20, 1);
  }

  getMetrics() {
    return {
      activeBrowsers: this.active,
      queuedRequests: this.waiters.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
    };
  }

  async run<T>(fn: () => Promise<T>, waitTimeoutMs = 15000): Promise<T> {
    await this.acquire(waitTimeoutMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(waitTimeoutMs: number): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }

    if (this.waiters.length >= this.maxQueueSize) {
      return Promise.reject(
        new ConcurrencyLimitError(
          "WORKER_QUEUE_FULL",
          "Browser worker queue is temporarily full. Retry shortly.",
          503
        )
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.waiters.indexOf(wake);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(
          new ConcurrencyLimitError(
            "WORKER_CONCURRENCY_TIMEOUT",
            "Timed out waiting for an available browser slot.",
            503
          )
        );
      }, waitTimeoutMs);

      const wake = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.active += 1;
        resolve();
      };

      this.waiters.push(wake);
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}

export const workerBrowserLimiter = new BrowserConcurrencyLimiter();
