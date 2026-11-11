import crypto from "node:crypto";
import type {
  WorkerCrawlPayload,
  WorkerCrawlResponse,
} from "../crawler/types";
import type { PreviewRenderResponse } from "./types";

export class WorkerClientError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function getWorkerEndpoint(): { url: string; secret: string } | null {
  const rawUrl = process.env.BROWSER_WORKER_URL?.trim();
  const rawSecret = process.env.BROWSER_WORKER_SECRET?.trim() ?? "";

  if (!rawUrl || rawUrl.includes("placeholder")) {
    if (process.env.NODE_ENV !== "production") {
      return { url: "http://127.0.0.1:4001", secret: rawSecret };
    }
    return null;
  }

  return {
    url: rawUrl.replace(/\/+$/, ""),
    secret: rawSecret.includes("placeholder") ? "" : rawSecret,
  };
}

async function callWorkerEndpoint<T>(
  path: "/render" | "/crawl",
  body: unknown,
  timeoutMs = 35000
): Promise<T> {
  const endpoint = getWorkerEndpoint();
  if (!endpoint) {
    throw new WorkerClientError(
      "WORKER_UNCONFIGURED",
      "BROWSER_WORKER_URL is not configured for isolated browser execution.",
      503
    );
  }

  let response: Response;
  try {
    response = await fetch(`${endpoint.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.secret
          ? { Authorization: `Bearer ${endpoint.secret}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    if (isTimeout) {
      throw new WorkerClientError(
        "WORKER_TIMEOUT",
        "The isolated browser service timed out while processing the request.",
        504
      );
    }
    throw new WorkerClientError(
      "WORKER_UNAVAILABLE",
      `Could not connect to the isolated browser worker at ${endpoint.url}. Start it locally with "npm run worker:dev".`,
      503
    );
  }

  const payload = (await response.json().catch(() => ({}))) as
    | (T & { error?: never })
    | { error?: { code?: string; message?: string } };

  if (!response.ok) {
    const errBody =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new WorkerClientError(
      errBody?.code ?? "WORKER_ERROR",
      errBody?.message ?? "Browser worker execution failed.",
      response.status
    );
  }

  return payload as T;
}

export async function requestWorkerPreviewRender(input: {
  url: string;
  viewport: { width: number; height: number };
  timeoutMs?: number;
}): Promise<PreviewRenderResponse> {
  const data = await callWorkerEndpoint<Omit<PreviewRenderResponse, "previewId">>(
    "/render",
    input,
    35000
  );

  return {
    previewId: crypto.randomUUID(),
    ...data,
  };
}

export async function requestWorkerCrawl(
  input: WorkerCrawlPayload
): Promise<WorkerCrawlResponse> {
  return callWorkerEndpoint<WorkerCrawlResponse>("/crawl", input, 45000);
}
