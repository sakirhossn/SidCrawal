import crypto from "node:crypto";
import http from "node:http";
import { z } from "zod";
import {
  renderWebsitePreview,
  resolveChromiumExecutablePath,
  WorkerRenderError,
} from "./browser.js";
import {
  ConcurrencyLimitError,
  workerBrowserLimiter,
} from "./concurrency.js";
import { executeMonitorCrawl } from "./crawler.js";

const PORT = Number(process.env.PORT ?? "4001");
const HOST =
  process.env.HOST ??
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const WORKER_SECRET = process.env.BROWSER_WORKER_SECRET?.trim() ?? "";
const MAX_RENDER_BODY_BYTES = 32 * 1024;
const MAX_CRAWL_BODY_BYTES = 8 * 1024 * 1024;

const renderBodySchema = z.object({
  url: z.string().min(1).max(2048),
  viewport: z
    .object({
      width: z.number().int().min(320).max(1920),
      height: z.number().int().min(480).max(1200),
    })
    .default({ width: 1280, height: 800 }),
  timeoutMs: z.number().int().min(3000).max(30000).optional(),
});

const crawlBodySchema = z.object({
  url: z.string().min(1).max(2048),
  selectionType: z.enum(["element", "multi_element", "region"]),
  cssSelector: z.string().max(1000).nullable(),
  selectors: z.array(z.string().max(1000)).max(25).default([]),
  boundingBox: z
    .object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().min(1),
      height: z.number().min(1),
    })
    .nullable(),
  viewport: z
    .object({
      width: z.number().int().min(320).max(1920),
      height: z.number().int().min(480).max(1200),
      deviceScaleFactor: z.number().min(1).max(3).default(1),
    })
    .default({ width: 1280, height: 800, deviceScaleFactor: 1 }),
  normalizationRules: z
    .object({
      collapseWhitespace: z.boolean().optional(),
      ignoreNumbers: z.boolean().optional(),
      stripTimestamps: z.boolean().optional(),
      ignoreRegexPatterns: z.array(z.string().max(120)).max(5).optional(),
      visualDiffThresholdPercent: z.number().min(0).max(100).optional(),
    })
    .default({}),
  timeoutMs: z.number().int().min(2000).max(30000).optional(),
  previousBaseline: z
    .object({
      snapshotId: z.string().min(1),
      contentHash: z.string().min(1),
      normalizedText: z.string().default(""),
      visualHash: z.string().nullable().default(null),
      elementScreenshotBase64: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
});

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function isAuthorized(authHeader: string | undefined): boolean {
  if (!WORKER_SECRET) {
    // Require configured secret in production; allow local unconfigured dev testing only when explicitly unset on loopback
    return process.env.NODE_ENV !== "production";
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }
  const provided = Buffer.from(authHeader.slice("Bearer ".length));
  const expected = Buffer.from(WORKER_SECRET);
  if (provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}

function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new WorkerRenderError("PAYLOAD_TOO_LARGE", "Request body too large.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new WorkerRenderError("INVALID_JSON", "Invalid JSON payload.", 400));
      }
    });
    req.on("error", reject);
  });
}

async function handleAuthorizedEndpoint<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes: number,
  schema: z.ZodType<T>,
  handler: (data: T) => Promise<unknown>
): Promise<void> {
  if (!isAuthorized(req.headers.authorization)) {
    return sendJson(res, 401, {
      error: {
        code: "UNAUTHORIZED_WORKER",
        message: "Missing or invalid worker authorization secret.",
      },
    });
  }

  try {
    const rawBody = await readJsonBody(req, maxBytes);
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
      return sendJson(res, 400, {
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
      });
    }

    const result = await handler(parsed.data);
    return sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof WorkerRenderError || err instanceof ConcurrencyLimitError) {
      return sendJson(res, err.statusCode, {
        error: { code: err.code, message: err.message },
      });
    }
    console.error("[sidcrawal-browser-worker] unexpected worker error:", err);
    return sendJson(res, 500, {
      error: {
        code: "WORKER_INTERNAL_ERROR",
        message: "Unexpected failure inside the browser worker.",
      },
    });
  }
}

export function createWorkerServer(): http.Server {
  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && reqUrl.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "sidcrawal-browser-worker",
        chromiumAvailable: Boolean(resolveChromiumExecutablePath()),
        concurrency: workerBrowserLimiter.getMetrics(),
      });
    }

    if (req.method === "POST" && reqUrl.pathname === "/render") {
      return handleAuthorizedEndpoint(
        req,
        res,
        MAX_RENDER_BODY_BYTES,
        renderBodySchema,
        renderWebsitePreview
      );
    }

    if (req.method === "POST" && reqUrl.pathname === "/crawl") {
      return handleAuthorizedEndpoint(
        req,
        res,
        MAX_CRAWL_BODY_BYTES,
        crawlBodySchema,
        (data) => executeMonitorCrawl(data)
      );
    }

    return sendJson(res, 404, {
      error: { code: "NOT_FOUND", message: "Endpoint not found." },
    });
  });
}

// Start HTTP listener when executed as entrypoint
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("server.ts")) {
  const server = createWorkerServer();
  server.listen(PORT, HOST, () => {
    console.log(
      `[sidcrawal-browser-worker] listening on http://${HOST}:${PORT} (chromium=${Boolean(
        resolveChromiumExecutablePath()
      )})`
    );
  });
}
