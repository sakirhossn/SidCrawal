import type {
  WorkerCrawlFailureResult,
  WorkerCrawlPayload,
  WorkerCrawlResponse,
} from "../../src/lib/crawler/types.js";
import {
  getVisualDiffThreshold,
  normalizeExtractedText,
} from "../../src/lib/crawler/normalization.js";
import { sha256Hex } from "../../src/lib/crawler/fingerprint.js";
import {
  type WorkerUrlValidator,
  WorkerRenderError,
  withGuardedBrowserPage,
} from "./browser.js";
import { comparePngScreenshots, hashPngBuffer } from "./diff.js";
import { MAX_CAPTURE_HEIGHT } from "./extractor.js";

const MAX_EXTRACTED_HTML_BYTES = 50_000;
const MAX_EXTRACTED_TEXT_CHARS = 50_000;

interface DomTargetExtraction {
  pageTitle: string;
  docWidth: number;
  docHeight: number;
  matchedCount: number;
  visibleCount: number;
  extractedText: string;
  extractedHtml: string;
  clipBox: { x: number; y: number; width: number; height: number } | null;
}

function mapErrorOutcome(code: string): WorkerCrawlFailureResult["outcome"] {
  if (code === "WORKER_TIMEOUT") return "timeout";
  if (code === "BLOCKED_BY_CHALLENGE" || code === "SSRF_BLOCKED_TARGET" || code === "UPSTREAM_BLOCKED") {
    return "blocked";
  }
  return "failed";
}

function buildFailureResult(
  startedAt: number,
  code: string,
  message: string,
  httpStatus: number | null = null,
  resolvedIp: string | null = null
): WorkerCrawlFailureResult {
  return {
    ok: false,
    outcome: mapErrorOutcome(code),
    errorCode: code,
    errorMessage: message,
    httpStatus,
    resolvedIp,
    durationMs: Math.max(1, Date.now() - startedAt),
  };
}

/**
 * Executes an isolated Playwright crawl for a monitor selection, extracting normalized text,
 * bounded HTML, full-page & element/region PNG screenshots, and visual/text diff metrics.
 */
export async function executeMonitorCrawl(
  payload: WorkerCrawlPayload,
  options: { validateUrl?: WorkerUrlValidator } = {}
): Promise<WorkerCrawlResponse> {
  const startedAt = Date.now();
  const vpWidth = Math.max(320, Math.min(1920, Math.round(payload.viewport.width || 1280)));
  const vpHeight = Math.max(480, Math.min(1200, Math.round(payload.viewport.height || 800)));

  try {
    return await withGuardedBrowserPage(
      {
        url: payload.url,
        viewport: {
          width: vpWidth,
          height: vpHeight,
          deviceScaleFactor: payload.viewport.deviceScaleFactor ?? 1,
        },
        timeoutMs: payload.timeoutMs,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 SidCrawalBot/1.0",
        validateUrl: options.validateUrl,
      },
      async ({ page, pageTitle, httpStatus, finalUrl, resolvedIp }) => {
        if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
          throw new WorkerRenderError(
            "UPSTREAM_BLOCKED",
            `Target returned HTTP ${httpStatus} and refused automated crawl access.`,
            422,
            { httpStatus, resolvedIp }
          );
        }

        if (httpStatus >= 400) {
          throw new WorkerRenderError(
            "UPSTREAM_HTTP_ERROR",
            `Target website responded with HTTP ${httpStatus}.`,
            502,
            { httpStatus, resolvedIp }
          );
        }

        const effectiveSelectors =
          payload.selectionType === "region"
            ? []
            : payload.selectors.length > 0
              ? payload.selectors
              : payload.cssSelector
                ? [payload.cssSelector]
                : [];

        const argJson = JSON.stringify({
          selectionType: payload.selectionType,
          selectors: effectiveSelectors,
          boundingBox: payload.boundingBox,
          vpWidth,
          maxHeight: MAX_CAPTURE_HEIGHT,
          maxHtmlBytes: MAX_EXTRACTED_HTML_BYTES,
          maxTextChars: MAX_EXTRACTED_TEXT_CHARS,
        });

        // Raw JS expression avoids tsx/esbuild keepNames (__name) injection inside Chromium
        const extractionScript = `((cfg) => {
          "use strict";
          const docTitle = (document.title || "").trim();
          const docWidth = Math.max(
            cfg.vpWidth,
            Math.min(document.documentElement.scrollWidth || cfg.vpWidth, cfg.vpWidth)
          );
          const docHeight = Math.max(
            400,
            Math.min(document.documentElement.scrollHeight || 800, cfg.maxHeight)
          );

          if (cfg.selectionType === "region") {
            const box = cfg.boundingBox;
            if (!box || box.width < 1 || box.height < 1 || box.x >= docWidth || box.y >= docHeight) {
              return {
                pageTitle: docTitle,
                docWidth,
                docHeight,
                matchedCount: 0,
                visibleCount: 0,
                extractedText: "",
                extractedHtml: "",
                clipBox: null,
              };
            }

            const cx = Math.max(0, Math.min(docWidth - 1, Math.round(box.x)));
            const cy = Math.max(0, Math.min(docHeight - 1, Math.round(box.y)));
            const cw = Math.max(1, Math.min(docWidth - cx, Math.round(box.width)));
            const ch = Math.max(1, Math.min(docHeight - cy, Math.round(box.height)));

            const allNodes = document.body ? Array.from(document.body.querySelectorAll("*")) : [];
            const candidates = [];

            const getDepth = (el) => {
              let d = 0;
              let cur = el;
              while (cur && cur.parentElement) {
                d += 1;
                cur = cur.parentElement;
              }
              return d;
            };

            for (const el of allNodes) {
              const style = window.getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) {
                continue;
              }
              const rect = el.getBoundingClientRect();
              const x = Math.round(rect.left + window.scrollX);
              const y = Math.round(rect.top + window.scrollY);
              const w = Math.round(rect.width);
              const h = Math.round(rect.height);
              if (w < 8 || h < 8) continue;

              const ix = Math.max(0, Math.min(x + w, cx + cw) - Math.max(x, cx));
              const iy = Math.max(0, Math.min(y + h, cy + ch) - Math.max(y, cy));
              if (ix <= 0 || iy <= 0) continue;

              const area = Math.max(1, w * h);
              if ((ix * iy) / area < 0.5) continue;

              const text = (el instanceof HTMLElement ? el.innerText : el.textContent || "").trim();
              if (!text) continue;
              candidates.push({
                el,
                depth: getDepth(el),
                area,
                text,
                html: el.outerHTML || "",
              });
            }

            const leafScoped = candidates.filter((child) => {
              return !candidates.some(
                (parent) =>
                  parent !== child &&
                  parent.depth < child.depth &&
                  parent.area > child.area &&
                  parent.text.length < 300 &&
                  parent.text.includes(child.text)
              );
            });

            const finalNodes = leafScoped.length > 0 ? leafScoped : candidates;
            const extractedText = finalNodes.map((n) => n.text).join("\\n").slice(0, cfg.maxTextChars);
            const extractedHtml = finalNodes.map((n) => n.html).join("\\n").slice(0, cfg.maxHtmlBytes);

            return {
              pageTitle: docTitle,
              docWidth,
              docHeight,
              matchedCount: 1,
              visibleCount: 1,
              extractedText,
              extractedHtml,
              clipBox: { x: cx, y: cy, width: cw, height: ch },
            };
          }

          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let matchedCount = 0;
          let visibleCount = 0;
          const texts = [];
          const htmlParts = [];

          for (const sel of cfg.selectors) {
            let el = null;
            try {
              el = document.querySelector(sel);
            } catch {
              el = null;
            }
            if (!el) continue;
            matchedCount += 1;

            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) {
              continue;
            }
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;

            visibleCount += 1;
            const left = rect.left + window.scrollX;
            const top = rect.top + window.scrollY;
            minX = Math.min(minX, left);
            minY = Math.min(minY, top);
            maxX = Math.max(maxX, left + rect.width);
            maxY = Math.max(maxY, top + rect.height);

            const txt = (el instanceof HTMLElement ? el.innerText : el.textContent || "").trim();
            if (txt) texts.push(txt);
            if (el.outerHTML) htmlParts.push(el.outerHTML);
          }

          let clipBox = null;
          if (visibleCount > 0 && Number.isFinite(minX)) {
            const cx = Math.max(0, Math.min(docWidth - 1, Math.floor(minX)));
            const cy = Math.max(0, Math.min(docHeight - 1, Math.floor(minY)));
            const cw = Math.max(1, Math.min(docWidth - cx, Math.ceil(maxX - cx)));
            const ch = Math.max(1, Math.min(docHeight - cy, Math.ceil(maxY - cy)));
            clipBox = { x: cx, y: cy, width: cw, height: ch };
          }

          return {
            pageTitle: docTitle,
            docWidth,
            docHeight,
            matchedCount,
            visibleCount,
            extractedText: texts.join("\\n").slice(0, cfg.maxTextChars),
            extractedHtml: htmlParts.join("\\n").slice(0, cfg.maxHtmlBytes),
            clipBox,
          };
        })(${argJson})`;

        const domData = (await page.evaluate(extractionScript)) as DomTargetExtraction;

        if (payload.selectionType === "region" && !domData.clipBox) {
          throw new WorkerRenderError(
            "REGION_OUT_OF_BOUNDS",
            "Saved visual region falls outside the rendered document dimensions.",
            422,
            { httpStatus, resolvedIp }
          );
        }

        if (payload.selectionType !== "region") {
          if (domData.matchedCount === 0) {
            throw new WorkerRenderError(
              "SELECTOR_NOT_FOUND",
              `Target CSS selector (${effectiveSelectors[0] ?? "none"}) matched no elements on the page.`,
              422,
              { httpStatus, resolvedIp }
            );
          }
          if (domData.visibleCount === 0 || !domData.clipBox) {
            throw new WorkerRenderError(
              "SELECTOR_NOT_VISIBLE",
              "Matched target element is hidden or has zero visible dimensions.",
              422,
              { httpStatus, resolvedIp }
            );
          }
        }

        const captureHeight = Math.min(domData.docHeight, MAX_CAPTURE_HEIGHT);

        const [fullPngBuffer, elementPngBuffer] = await Promise.all([
          page.screenshot({
            type: "png",
            fullPage: true,
            clip: {
              x: 0,
              y: 0,
              width: vpWidth,
              height: captureHeight,
            },
          }),
          page.screenshot({
            type: "png",
            fullPage: true,
            clip: domData.clipBox!,
          }),
        ]);

        const normalizedText = normalizeExtractedText(
          domData.extractedText,
          payload.normalizationRules
        );
        const contentHash = sha256Hex(normalizedText);
        const visualHash = hashPngBuffer(elementPngBuffer);

        const prev = payload.previousBaseline ?? null;
        let textChanged = false;
        let visualChanged = false;
        let visualDiffPercentage = 0;
        let mismatchedPixels = 0;
        let totalPixels = 0;
        let dimensionChanged = false;
        let diffPngBuffer: Buffer | null = null;

        if (prev) {
          textChanged = contentHash !== prev.contentHash;
          const visualThreshold = getVisualDiffThreshold(payload.normalizationRules);

          if (prev.elementScreenshotBase64) {
            const prevBuffer = Buffer.from(prev.elementScreenshotBase64, "base64");
            const visualDiff = comparePngScreenshots(prevBuffer, elementPngBuffer);
            visualDiffPercentage = visualDiff.diffPercentage;
            mismatchedPixels = visualDiff.mismatchedPixels;
            totalPixels = visualDiff.totalPixels;
            dimensionChanged = visualDiff.dimensionChanged;
            visualChanged = visualDiffPercentage >= visualThreshold;
            if (visualChanged || textChanged) {
              diffPngBuffer = visualDiff.diffPngBuffer;
            }
          } else if (prev.visualHash) {
            visualChanged = visualHash !== prev.visualHash;
            visualDiffPercentage = visualChanged ? 100 : 0;
          }
        }

        const hasMeaningfulChange = Boolean(prev && (textChanged || visualChanged));
        const changeType = !hasMeaningfulChange
          ? null
          : textChanged && visualChanged
            ? "both"
            : textChanged
              ? "text"
              : "visual";

        return {
          ok: true,
          finalUrl,
          pageTitle: domData.pageTitle || pageTitle || finalUrl,
          httpStatus,
          resolvedIp,
          durationMs: Math.max(1, Date.now() - startedAt),
          extractedHtml: domData.extractedHtml,
          extractedText: domData.extractedText,
          normalizedText,
          contentHash,
          visualHash,
          fullPagePngBase64: fullPngBuffer.toString("base64"),
          elementPngBase64: elementPngBuffer.toString("base64"),
          diffPngBase64: diffPngBuffer ? diffPngBuffer.toString("base64") : null,
          visualDiffPercentage,
          mismatchedPixels,
          totalPixels,
          dimensionChanged,
          textChanged,
          visualChanged,
          hasMeaningfulChange,
          changeType,
        };
      }
    );
  } catch (err) {
    if (err instanceof WorkerRenderError) {
      return buildFailureResult(
        startedAt,
        err.code,
        err.message,
        err.httpStatus,
        err.resolvedIp
      );
    }
    const msg = err instanceof Error ? err.message : "Unexpected crawler error.";
    return buildFailureResult(startedAt, "CRAWL_UNEXPECTED_ERROR", msg);
  }
}
