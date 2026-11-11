import fs from "node:fs";
import { chromium, type Browser, type Page, type Response as PlaywrightResponse } from "playwright-core";
import { workerBrowserLimiter } from "./concurrency.js";
import {
  detectBlockedChallengeOnPage,
  extractDomPreviewData,
  type ExtractedElement,
  MAX_CAPTURE_HEIGHT,
} from "./extractor.js";
import {
  validateWorkerTargetUrl,
  type WorkerSsrfResult,
} from "./ssrf.js";

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20000;
const HARD_JOB_OVERHEAD_MS = 15000;

export interface RenderPreviewRequest {
  url: string;
  viewport: {
    width: number;
    height: number;
  };
  timeoutMs?: number;
}

export interface RenderPreviewResponse {
  finalUrl: string;
  pageTitle: string;
  httpStatus: number;
  resolvedIp: string | null;
  frameBlockedByHeader: boolean;
  framePolicyHeader: string | null;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  documentDimensions: {
    width: number;
    height: number;
  };
  screenshotDataUrl: string;
  elements: ExtractedElement[];
}

export class WorkerRenderError extends Error {
  code: string;
  statusCode: number;
  httpStatus: number | null;
  resolvedIp: string | null;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: { httpStatus?: number | null; resolvedIp?: string | null }
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.httpStatus = details?.httpStatus ?? null;
    this.resolvedIp = details?.resolvedIp ?? null;
  }
}

export type WorkerUrlValidator = (rawUrl: string) => Promise<WorkerSsrfResult>;

export interface GuardedPageContext {
  page: Page;
  mainResponse: PlaywrightResponse;
  pageTitle: string;
  httpStatus: number;
  finalUrl: string;
  resolvedIp: string | null;
  frameBlockedByHeader: boolean;
  framePolicyHeader: string | null;
}

export function resolveChromiumExecutablePath(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  try {
    const bundled = chromium.executablePath();
    if (bundled && fs.existsSync(bundled)) {
      return bundled;
    }
  } catch {
    // Fall through to system browser discovery
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

/**
 * Executes a guarded Playwright browser session enforcing initial + redirect-hop SSRF validation,
 * transfer size caps, execution timeouts, and anti-bot challenge detection (never bypassed).
 */
export async function withGuardedBrowserPage<T>(
  options: {
    url: string;
    viewport: { width: number; height: number; deviceScaleFactor?: number };
    timeoutMs?: number;
    userAgent?: string;
    validateUrl?: WorkerUrlValidator;
  },
  handler: (ctx: GuardedPageContext) => Promise<T>
): Promise<T> {
  const validateUrl = options.validateUrl ?? validateWorkerTargetUrl;

  const initialSsrf = await validateUrl(options.url);
  if (!initialSsrf.ok || !initialSsrf.normalizedUrl) {
    throw new WorkerRenderError(
      initialSsrf.code ?? "SSRF_BLOCKED_TARGET",
      initialSsrf.reason ?? "Target URL failed SSRF security validation.",
      initialSsrf.code === "INVALID_URL" ? 400 : 403
    );
  }

  const targetUrl = initialSsrf.normalizedUrl;
  const executablePath = resolveChromiumExecutablePath();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 2000), 30000);
  const launchArgs = ["--disable-dev-shm-usage"];
  if (process.env.PLAYWRIGHT_NO_SANDBOX === "true") {
    launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  const hardJobTimeoutMs = Math.min(timeoutMs + HARD_JOB_OVERHEAD_MS, 45000);

  return workerBrowserLimiter.run(async () => {
    let browser: Browser | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      browser = await chromium.launch({
        headless: true,
        executablePath,
        args: launchArgs,
      });

      const runSession = async (): Promise<T> => {
        const context = await browser!.newContext({
      viewport: {
        width: options.viewport.width,
        height: options.viewport.height,
      },
      deviceScaleFactor: options.viewport.deviceScaleFactor ?? 1,
      userAgent:
        options.userAgent ??
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 SidCrawalWorker/1.0",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    let ssrfBlockReason: string | null = null;
    let totalDocumentBytes = 0;

    await page.route("**/*", async (route) => {
      const req = route.request();
      const reqUrl = req.url();

      if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) {
        return route.continue();
      }

      if (!reqUrl.startsWith("http://") && !reqUrl.startsWith("https://")) {
        return route.abort("blockedbyclient");
      }

      if (req.isNavigationRequest()) {
        const navCheck = await validateUrl(reqUrl);
        if (!navCheck.ok) {
          ssrfBlockReason =
            navCheck.reason ?? "Redirected navigation resolved to a blocked target.";
          return route.abort("blockedbyclient");
        }
      }

      return route.continue();
    });

    page.on("response", async (res) => {
      try {
        const headers = res.headers();
        const contentLen = Number(headers["content-length"] ?? "0");
        if (Number.isFinite(contentLen) && contentLen > 0) {
          totalDocumentBytes += contentLen;
        }
      } catch {
        // Ignore transient header read errors
      }
    });

    let mainResponse: PlaywrightResponse | null;
    try {
      mainResponse = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
    } catch (err) {
      if (ssrfBlockReason) {
        throw new WorkerRenderError("SSRF_BLOCKED_TARGET", ssrfBlockReason, 403);
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("timeout")) {
        throw new WorkerRenderError(
          "WORKER_TIMEOUT",
          `Website did not finish loading within ${Math.round(timeoutMs / 1000)}s.`,
          504
        );
      }
      throw new WorkerRenderError(
        "NAVIGATION_FAILED",
        `Unable to load website: ${message}`,
        502
      );
    }

    if (ssrfBlockReason) {
      throw new WorkerRenderError("SSRF_BLOCKED_TARGET", ssrfBlockReason, 403);
    }

    if (!mainResponse) {
      throw new WorkerRenderError(
        "NAVIGATION_FAILED",
        "No HTTP response received from the target website.",
        502
      );
    }

    if (totalDocumentBytes > MAX_DOCUMENT_BYTES) {
      throw new WorkerRenderError(
        "PAGE_SIZE_LIMIT_EXCEEDED",
        "Target webpage exceeded the 15 MB transfer limit.",
        413
      );
    }

    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(350);

    const headers = mainResponse.headers();
    const xfo = headers["x-frame-options"] ?? null;
    const csp = headers["content-security-policy"] ?? null;
    const frameAncestorsMatch = csp
      ?.split(";")
      .map((d) => d.trim())
      .find((d) => d.toLowerCase().startsWith("frame-ancestors"));

    const frameBlockedByHeader = Boolean(
      xfo ||
        (frameAncestorsMatch &&
          !frameAncestorsMatch.toLowerCase().includes("*"))
    );
    const framePolicyHeader = xfo
      ? `X-Frame-Options: ${xfo}`
      : frameAncestorsMatch ?? null;

    const httpStatus = mainResponse.status();
    const finalUrl = page.url();
    const finalCheck = await validateUrl(finalUrl);
    if (!finalCheck.ok) {
      throw new WorkerRenderError(
        "SSRF_BLOCKED_TARGET",
        finalCheck.reason ?? "Final redirected URL is blocked.",
        403
      );
    }

    const serverDetails = await mainResponse.serverAddr().catch(() => null);
    const resolvedIp =
      serverDetails?.ipAddress ?? initialSsrf.resolvedIps?.[0] ?? null;

    const challengeCheck = await detectBlockedChallengeOnPage(page);
    if (challengeCheck.blockedChallengeSignal) {
      throw new WorkerRenderError(
        "BLOCKED_BY_CHALLENGE",
        `${challengeCheck.blockedChallengeSignal} SidCrawal never bypasses CAPTCHAs, login walls, or anti-bot protections.`,
        422,
        { httpStatus, resolvedIp }
      );
    }

        return await handler({
          page,
          mainResponse,
          pageTitle: challengeCheck.pageTitle || finalUrl,
          httpStatus,
          finalUrl,
          resolvedIp,
          frameBlockedByHeader,
          framePolicyHeader,
        });
      };

      const sessionPromise = runSession();
      sessionPromise.catch(() => {
        // Prevent unhandled rejection if watchdog wins race and browser.close aborts in-flight page calls
      });

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        watchdogTimer = setTimeout(() => {
          reject(
            new WorkerRenderError(
              "WORKER_TIMEOUT",
              `Browser execution exceeded hard limit (${Math.round(hardJobTimeoutMs / 1000)}s).`,
              504
            )
          );
        }, hardJobTimeoutMs);
      });

      return await Promise.race([sessionPromise, timeoutPromise]);
    } finally {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  });
}

export async function renderWebsitePreview(
  input: RenderPreviewRequest
): Promise<RenderPreviewResponse> {
  return withGuardedBrowserPage(
    {
      url: input.url,
      viewport: input.viewport,
      timeoutMs: input.timeoutMs,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 SidCrawalPreview/1.0",
    },
    async ({
      page,
      httpStatus,
      finalUrl,
      resolvedIp,
      frameBlockedByHeader,
      framePolicyHeader,
    }) => {
      const extracted = await extractDomPreviewData(page, input.viewport.width);
      if (extracted.blockedChallengeSignal) {
        throw new WorkerRenderError(
          "BLOCKED_BY_CHALLENGE",
          `${extracted.blockedChallengeSignal} SidCrawal never bypasses CAPTCHAs, login walls, or anti-bot protections.`,
          422,
          { httpStatus, resolvedIp }
        );
      }

      if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
        if (extracted.elements.length < 3) {
          throw new WorkerRenderError(
            "BLOCKED_BY_CHALLENGE",
            `Target returned HTTP ${httpStatus} and restricted page content.`,
            422,
            { httpStatus, resolvedIp }
          );
        }
      }

      const captureHeight = Math.min(
        extracted.documentDimensions.height,
        MAX_CAPTURE_HEIGHT
      );

      const pngBuffer = await page.screenshot({
        type: "png",
        fullPage: true,
        clip: {
          x: 0,
          y: 0,
          width: input.viewport.width,
          height: captureHeight,
        },
      });

      return {
        finalUrl,
        pageTitle: extracted.pageTitle || finalUrl,
        httpStatus,
        resolvedIp,
        frameBlockedByHeader,
        framePolicyHeader,
        viewport: {
          width: input.viewport.width,
          height: input.viewport.height,
          deviceScaleFactor: 1,
        },
        documentDimensions: {
          width: extracted.documentDimensions.width,
          height: captureHeight,
        },
        screenshotDataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
        elements: extracted.elements,
      };
    }
  );
}
