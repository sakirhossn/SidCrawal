import { NextResponse } from "next/server";
import { jsonError, parseValidatedJson } from "@/lib/auth/http";
import { requireVerifiedMonitorSession } from "@/lib/monitors/auth-guard";
import { previewRenderRequestSchema } from "@/lib/monitors/schemas";
import {
  requestWorkerPreviewRender,
  WorkerClientError,
} from "@/lib/preview/worker-client";
import { applyRateLimit } from "@/lib/security/rate-limit";
import { validatePublicTargetWithDns } from "@/lib/security/ssrf";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { recordApiErrorEvent } from "@/lib/telemetry/api-errors";

export async function POST(request: Request) {
  const rateLimit = await applyRateLimit(request, "preview_render");
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  const validated = await parseValidatedJson(request, previewRenderRequestSchema);
  if ("response" in validated) {
    return validated.response;
  }

  if (isSupabaseConfigured()) {
    const auth = await requireVerifiedMonitorSession();
    if ("response" in auth) {
      return auth.response;
    }
  } else if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_UNAUTHENTICATED_LOCAL_PREVIEW !== "true"
  ) {
    return jsonError(
      "SUPABASE_UNCONFIGURED",
      "Supabase authentication must be configured before rendering websites in production.",
      503
    );
  }

  const ssrfCheck = await validatePublicTargetWithDns(validated.data.url);
  if (!ssrfCheck.ok || !ssrfCheck.normalizedUrl) {
    const status =
      ssrfCheck.code === "SSRF_BLOCKED_TARGET"
        ? 403
        : ssrfCheck.code === "DNS_RESOLUTION_FAILED"
          ? 422
          : 400;
    if (status === 403) {
      void recordApiErrorEvent({
        route: "/api/preview/render",
        method: "POST",
        statusCode: status,
        errorCode: ssrfCheck.code ?? "SSRF_BLOCKED_TARGET",
        message: ssrfCheck.reason ?? "Blocked preview target URL.",
      });
    }
    return jsonError(
      ssrfCheck.code ?? "INVALID_URL",
      ssrfCheck.reason ?? "Target URL is not valid.",
      status
    );
  }

  try {
    const preview = await requestWorkerPreviewRender({
      url: ssrfCheck.normalizedUrl,
      viewport: validated.data.viewport,
    });
    return NextResponse.json(preview, { status: 200, headers: rateLimit.headers });
  } catch (err) {
    if (err instanceof WorkerClientError) {
      void recordApiErrorEvent({
        route: "/api/preview/render",
        method: "POST",
        statusCode: err.statusCode,
        errorCode: err.code,
        message: err.message,
      });
      return jsonError(err.code, err.message, err.statusCode);
    }
    void recordApiErrorEvent({
      route: "/api/preview/render",
      method: "POST",
      statusCode: 500,
      errorCode: "PREVIEW_RENDER_FAILED",
      message: err instanceof Error ? err.message : "Unexpected preview render error.",
    });
    return jsonError(
      "PREVIEW_RENDER_FAILED",
      "Unexpected error while rendering website preview.",
      500
    );
  }
}
