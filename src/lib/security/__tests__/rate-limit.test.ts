import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLimit, mockRecordApiError } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockRecordApiError: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class MockRedis {
    constructor(public readonly config: unknown) {}
  },
}));

vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    static slidingWindow = vi.fn(() => "sliding-window-limiter");
    limit = mockLimit;
  }
  return { Ratelimit: MockRatelimit };
});

vi.mock("@/lib/telemetry/api-errors", () => ({
  recordApiErrorEvent: mockRecordApiError,
}));

import {
  applyRateLimit,
  isUpstashRateLimitConfigured,
  resetInMemoryRateLimits,
  resetUpstashClientCache,
} from "@/lib/security/rate-limit";

describe("API rate limiting & Upstash failover", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetInMemoryRateLimits();
    resetUpstashClientCache();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetInMemoryRateLimits();
    resetUpstashClientCache();
  });

  it("treats placeholder or malformed Upstash env variables as unconfigured", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://your-upstash-endpoint.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "placeholder-token";
    expect(isUpstashRateLimitConfigured()).toBe(false);

    process.env.UPSTASH_REDIS_REST_URL = "not-a-valid-url";
    process.env.UPSTASH_REDIS_REST_TOKEN = "real_token_123";
    expect(isUpstashRateLimitConfigured()).toBe(false);

    process.env.UPSTASH_REDIS_REST_URL = "https://sidcrawal-prod.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "AX1234567890_real_token";
    expect(isUpstashRateLimitConfigured()).toBe(true);
  });

  it("enforces sliding-window quotas in local fallback and emits 429 headers", async () => {
    const makeReq = () =>
      new Request("https://sidcrawal.app/api/auth/register", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.42" },
      });

    for (let i = 0; i < 5; i += 1) {
      const allowed = await applyRateLimit(makeReq(), "auth_register");
      expect(allowed.allowed).toBe(true);
      expect(allowed.backend).toBe("memory");
      expect(allowed.headers["X-RateLimit-Limit"]).toBe("5");
    }

    const blocked = await applyRateLimit(makeReq(), "auth_register");
    expect(blocked.allowed).toBe(false);
    expect(blocked.response?.status).toBe(429);
    expect(blocked.headers["Retry-After"]).toBeTruthy();

    const json = await blocked.response?.json();
    expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(mockRecordApiError).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/auth/register",
        statusCode: 429,
        errorCode: "RATE_LIMIT_EXCEEDED",
      })
    );
  });

  it("uses Upstash Redis when configured and fails open to memory if Redis errors", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://sidcrawal-prod.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "AX1234567890_real_token";

    mockLimit.mockResolvedValueOnce({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60_000,
    });

    const okRes = await applyRateLimit(
      new Request("https://sidcrawal.app/api/auth/login", {
        method: "POST",
        headers: { "x-real-ip": "198.51.100.10" },
      }),
      "auth_login",
      { identifierSuffix: "owner@example.com" }
    );

    expect(okRes.allowed).toBe(true);
    expect(okRes.backend).toBe("upstash");
    expect(mockLimit).toHaveBeenCalledWith("198.51.100.10:owner@example.com");

    mockLimit.mockRejectedValueOnce(new Error("Upstash ETIMEDOUT"));
    const fallbackRes = await applyRateLimit(
      new Request("https://sidcrawal.app/api/auth/login", {
        method: "POST",
        headers: { "x-real-ip": "198.51.100.10" },
      }),
      "auth_login"
    );

    expect(fallbackRes.allowed).toBe(true);
    expect(fallbackRes.backend).toBe("memory_fallback");
    expect(mockRecordApiError).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/auth/login",
        statusCode: 503,
        errorCode: "RATE_LIMIT_BACKEND_ERROR",
      })
    );
  });
});
