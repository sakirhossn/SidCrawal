export interface Env {
  NEXT_APP_URL?: string;
  CLOUDFLARE_DISPATCH_SECRET?: string;
  DISPATCH_BATCH_LIMIT?: string;
  DISPATCH_WORKER_ID?: string;
}

export interface DispatchOutcome {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function dispatchDueCrawlJobs(env: Env): Promise<DispatchOutcome> {
  const appUrl = env.NEXT_APP_URL?.trim().replace(/\/+$/, "");
  const secret = env.CLOUDFLARE_DISPATCH_SECRET?.trim();

  if (!appUrl || !secret) {
    throw new Error(
      "NEXT_APP_URL and CLOUDFLARE_DISPATCH_SECRET must be configured on the Cloudflare Worker."
    );
  }

  const limit = Math.min(Math.max(Number(env.DISPATCH_BATCH_LIMIT ?? "10") || 10, 1), 25);
  const workerId = env.DISPATCH_WORKER_ID?.trim() || "cloudflare-cron";

  const response = await fetch(`${appUrl}/api/internal/dispatch-due`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      limit,
      workerId,
      mode: "auto",
    }),
  });

  const body = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "sidcrawal-cron-dispatcher",
        configured: Boolean(env.NEXT_APP_URL && env.CLOUDFLARE_DISPATCH_SECRET),
      });
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(
    _event: { scheduledTime: number; cron: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<void> {
    ctx.waitUntil(dispatchDueCrawlJobs(env));
  },
};

export default worker;
