import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { recordApiErrorEvent } from "@/lib/telemetry/api-errors";

export type RateLimitPolicyName =
  | "auth_login"
  | "auth_register"
  | "auth_recovery"
  | "preview_render"
  | "monitor_crawl"
  | "monitor_write"
  | "public_health";

interface PolicyDefinition {
  limit: number;
  windowSeconds: number;
  windowLiteral: `${number} s` | `${number} m`;
  message: string;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicyName, PolicyDefinition> = {
  auth_login: {
    limit: 10,
    windowSeconds: 60,
    windowLiteral: "1 m",
    message: "Too many login attempts. Please wait a minute before trying again.",
  },
  auth_register: {
    limit: 5,
    windowSeconds: 900,
    windowLiteral: "15 m",
    message: "Too many registration attempts from this IP. Please try again later.",
  },
  auth_recovery: {
    limit: 5,
    windowSeconds: 900,
    windowLiteral: "15 m",
    message: "Too many verification or password reset requests. Please wait 15 minutes.",
  },
  preview_render: {
    limit: 15,
    windowSeconds: 60,
    windowLiteral: "1 m",
    message: "Preview render rate limit reached. Slow down briefly before loading another URL.",
  },
  monitor_crawl: {
    limit: 6,
    windowSeconds: 60,
    windowLiteral: "1 m",
    message: "Manual crawl rate limit reached. Wait a minute before triggering another crawl.",
  },
  monitor_write: {
    limit: 20,
    windowSeconds: 60,
    windowLiteral: "1 m",
    message: "Too many monitor configuration updates. Please wait briefly.",
  },
  public_health: {
    limit: 60,
    windowSeconds: 60,
    windowLiteral: "1 m",
    message: "Health endpoint rate limit exceeded.",
  },
};

const PLACEHOLDER_MARKERS = ["placeholder", "your-"];

function isRealEnv(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

export function isUpstashRateLimitConfigured(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!isRealEnv(url) || !isRealEnv(token)) {
    return false;
  }
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function extractClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "local";
}

// Local sliding-window fallback store (dev/test & Redis failover)
const memoryStore = new Map<string, number[]>();

export function resetInMemoryRateLimits(): void {
  memoryStore.clear();
}

function checkInMemoryWindow(
  key: string,
  limit: number,
  windowSeconds: number
): { success: boolean; limit: number; remaining: number; reset: number } {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;
  const hits = (memoryStore.get(key) ?? []).filter((ts) => ts > cutoff);

  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    memoryStore.set(key, hits);
    return {
      success: false,
      limit,
      remaining: 0,
      reset: oldest + windowMs,
    };
  }

  hits.push(now);
  memoryStore.set(key, hits);

  // Prevent unbounded growth on long-lived Node servers
  if (memoryStore.size > 5000) {
    const firstKey = memoryStore.keys().next().value;
    if (firstKey) memoryStore.delete(firstKey);
  }

  return {
    success: true,
    limit,
    remaining: Math.max(0, limit - hits.length),
    reset: (hits[0] ?? now) + windowMs,
  };
}

let cachedRedisClient: Redis | null = null;
const cachedLimiters = new Map<RateLimitPolicyName, Ratelimit>();

function getUpstashLimiter(policyName: RateLimitPolicyName): Ratelimit | null {
  if (!isUpstashRateLimitConfigured()) {
    return null;
  }

  if (!cachedRedisClient) {
    cachedRedisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!.trim(),
      token: process.env.UPSTASH_REDIS_REST_TOKEN!.trim(),
    });
  }

  let limiter = cachedLimiters.get(policyName);
  if (!limiter) {
    const def = RATE_LIMIT_POLICIES[policyName];
    limiter = new Ratelimit({
      redis: cachedRedisClient,
      limiter: Ratelimit.slidingWindow(def.limit, def.windowLiteral),
      prefix: `sidcrawal:rl:${policyName}`,
    });
    cachedLimiters.set(policyName, limiter);
  }
  return limiter;
}

export function resetUpstashClientCache(): void {
  cachedRedisClient = null;
  cachedLimiters.clear();
}

export interface RateLimitCheckResult {
  allowed: boolean;
  backend: "upstash" | "memory" | "memory_fallback";
  limit: number;
  remaining: number;
  reset: number;
  headers: Record<string, string>;
  response?: NextResponse;
}

/**
 * Evaluates Upstash Redis sliding-window rate limit with graceful fail-open fallback to
 * in-memory windows if Redis is unconfigured or temporarily unreachable.
 */
export async function applyRateLimit(
  request: Request,
  policyName: RateLimitPolicyName,
  options?: { identifierSuffix?: string; userId?: string | null }
): Promise<RateLimitCheckResult> {
  const def = RATE_LIMIT_POLICIES[policyName];
  const ip = extractClientIp(request);
  const identifier = options?.identifierSuffix
    ? `${ip}:${options.identifierSuffix}`
    : ip;
  const route = new URL(request.url).pathname;

  let outcome: { success: boolean; limit: number; remaining: number; reset: number };
  let backend: RateLimitCheckResult["backend"] = "memory";

  const upstash = getUpstashLimiter(policyName);
  if (upstash) {
    try {
      const res = await upstash.limit(identifier);
      outcome = {
        success: res.success,
        limit: res.limit,
        remaining: res.remaining,
        reset: res.reset,
      };
      backend = "upstash";
    } catch {
      backend = "memory_fallback";
      void recordApiErrorEvent({
        route,
        method: request.method,
        statusCode: 503,
        errorCode: "RATE_LIMIT_BACKEND_ERROR",
        message: "Upstash Redis unreachable; fell back cleanly to local limiter.",
        userId: options?.userId ?? null,
      });
      outcome = checkInMemoryWindow(
        `${policyName}:${identifier}`,
        def.limit,
        def.windowSeconds
      );
    }
  } else {
    outcome = checkInMemoryWindow(
      `${policyName}:${identifier}`,
      def.limit,
      def.windowSeconds
    );
  }

  const retryAfterSec = Math.max(
    1,
    Math.ceil((outcome.reset - Date.now()) / 1000)
  );

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(outcome.limit),
    "X-RateLimit-Remaining": String(Math.max(0, outcome.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(outcome.reset / 1000)),
  };

  if (!outcome.success) {
    headers["Retry-After"] = String(retryAfterSec);

    void recordApiErrorEvent({
      route,
      method: request.method,
      statusCode: 429,
      errorCode: "RATE_LIMIT_EXCEEDED",
      message: `${policyName} limit exceeded (${def.limit}/${def.windowLiteral})`,
      userId: options?.userId ?? null,
    });

    return {
      allowed: false,
      backend,
      ...outcome,
      headers,
      response: NextResponse.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: def.message,
          },
        },
        {
          status: 429,
          headers,
        }
      ),
    };
  }

  return {
    allowed: true,
    backend,
    ...outcome,
    headers,
  };
}
