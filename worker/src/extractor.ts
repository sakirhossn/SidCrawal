import type { Page } from "playwright-core";

export interface ExtractedElement {
  id: string;
  selector: string;
  tag: string;
  text: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  metadata: {
    idAttr: string | null;
    classes: string[];
    role: string | null;
    ariaLabel: string | null;
    href: string | null;
    domDepth: number;
  };
}

export interface PageExtractionResult {
  pageTitle: string;
  documentDimensions: {
    width: number;
    height: number;
  };
  elements: ExtractedElement[];
  blockedChallengeSignal: string | null;
}

export const MAX_CAPTURE_HEIGHT = 3200;
const MAX_ELEMENTS = 350;

export const CHALLENGE_DETECTION_EXPRESSION = `(() => {
  const title = (document.title || "").trim();
  const bodyText = (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 4000);
  const htmlLower = (document.documentElement && document.documentElement.innerHTML ? document.documentElement.innerHTML : "")
    .slice(0, 12000)
    .toLowerCase();

  let blockedChallengeSignal = null;
  if (
    title.toLowerCase().includes("just a moment") ||
    htmlLower.includes("cf-browser-verification") ||
    htmlLower.includes("/cdn-cgi/challenge-platform") ||
    htmlLower.includes("cf-turnstile")
  ) {
    blockedChallengeSignal = "Cloudflare anti-bot verification challenge detected.";
  } else if (
    htmlLower.includes("g-recaptcha") ||
    htmlLower.includes("h-captcha") ||
    htmlLower.includes("px-captcha") ||
    htmlLower.includes("captcha-delivery.com")
  ) {
    blockedChallengeSignal = "CAPTCHA gate detected on the target website.";
  } else if (
    bodyText.toLowerCase().includes("verify you are human") ||
    bodyText.toLowerCase().includes("enable javascript and cookies to continue")
  ) {
    blockedChallengeSignal = "Human verification interstitial detected.";
  }

  return {
    pageTitle: title,
    blockedChallengeSignal,
  };
})()`;

export async function detectBlockedChallengeOnPage(page: Page): Promise<{
  pageTitle: string;
  blockedChallengeSignal: string | null;
}> {
  return (await page.evaluate(CHALLENGE_DETECTION_EXPRESSION)) as {
    pageTitle: string;
    blockedChallengeSignal: string | null;
  };
}

export async function extractDomPreviewData(
  page: Page,
  viewportWidth: number
): Promise<PageExtractionResult> {
  const safeVpWidth = Math.max(320, Math.min(1920, Math.round(viewportWidth)));

  // Evaluate as a raw JS string so tsx/esbuild keepNames (__name) transforms never break inside Chromium.
  const script = `(() => {
    "use strict";
    const maxHeight = ${MAX_CAPTURE_HEIGHT};
    const maxElements = ${MAX_ELEMENTS};
    const vpWidth = ${safeVpWidth};

    const title = (document.title || "").trim();
    const bodyText = (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 4000);
    const htmlLower = (document.documentElement && document.documentElement.innerHTML ? document.documentElement.innerHTML : "")
      .slice(0, 12000)
      .toLowerCase();

    let blockedChallengeSignal = null;
    if (
      title.toLowerCase().includes("just a moment") ||
      htmlLower.includes("cf-browser-verification") ||
      htmlLower.includes("/cdn-cgi/challenge-platform") ||
      htmlLower.includes("cf-turnstile")
    ) {
      blockedChallengeSignal = "Cloudflare anti-bot verification challenge detected.";
    } else if (
      htmlLower.includes("g-recaptcha") ||
      htmlLower.includes("h-captcha") ||
      htmlLower.includes("px-captcha") ||
      htmlLower.includes("captcha-delivery.com")
    ) {
      blockedChallengeSignal = "CAPTCHA gate detected on the target website.";
    } else if (
      bodyText.toLowerCase().includes("verify you are human") ||
      bodyText.toLowerCase().includes("enable javascript and cookies to continue")
    ) {
      blockedChallengeSignal = "Human verification interstitial detected.";
    }

    const docWidth = Math.max(
      vpWidth,
      Math.min(document.documentElement.scrollWidth || vpWidth, vpWidth)
    );
    const docHeight = Math.max(
      400,
      Math.min(document.documentElement.scrollHeight || 800, maxHeight)
    );

    if (blockedChallengeSignal) {
      return {
        pageTitle: title,
        documentDimensions: { width: docWidth, height: docHeight },
        elements: [],
        blockedChallengeSignal,
      };
    }

    const escapeCssIdent = (val) => {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(val);
      }
      return String(val).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    };

    const isUniqueSelector = (selector) => {
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };

    const buildSelector = (el) => {
      if (el.id && !/^\\d/.test(el.id)) {
        const idSel = "#" + escapeCssIdent(el.id);
        if (isUniqueSelector(idSel)) return idSel;
      }

      const dataTestId = el.getAttribute("data-testid");
      if (dataTestId) {
        const dtSel = el.tagName.toLowerCase() + '[data-testid="' + escapeCssIdent(dataTestId) + '"]';
        if (isUniqueSelector(dtSel)) return dtSel;
      }

      const parts = [];
      let current = el;
      let depth = 0;

      while (current && current.nodeType === 1 && depth < 6) {
        const tag = current.tagName.toLowerCase();
        if (tag === "html" || tag === "body") {
          parts.unshift(tag);
          break;
        }

        if (current.id && !/^\\d/.test(current.id)) {
          const anchor = "#" + escapeCssIdent(current.id);
          if (isUniqueSelector(anchor)) {
            parts.unshift(anchor);
            break;
          }
        }

        const parent = current.parentElement;
        let segment = tag;

        if (parent) {
          const targetTagName = current.tagName;
          const sameTagSiblings = Array.from(parent.children).filter(
            (child) => child.tagName === targetTagName
          );
          if (sameTagSiblings.length > 1) {
            const index = sameTagSiblings.indexOf(current) + 1;
            segment = tag + ":nth-of-type(" + index + ")";
          }
        }

        parts.unshift(segment);
        const candidate = parts.join(" > ");
        if (isUniqueSelector(candidate)) {
          return candidate;
        }
        current = parent;
        depth += 1;
      }

      return parts.join(" > ");
    };

    const getDomDepth = (el) => {
      let d = 0;
      let cur = el;
      while (cur && cur.parentElement) {
        d += 1;
        cur = cur.parentElement;
      }
      return d;
    };

    const CANDIDATE_TAGS = new Set([
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "a", "button", "li", "td", "th", "tr",
      "article", "section", "header", "footer", "nav", "main", "aside",
      "blockquote", "pre", "code", "span", "div", "table", "figure", "figcaption",
      "time", "label",
    ]);

    const elements = [];
    const seenBoxes = new Set();
    const allNodes = document.body ? Array.from(document.body.querySelectorAll("*")) : [];

    for (const node of allNodes) {
      if (elements.length >= maxElements) break;

      const tag = node.tagName.toLowerCase();
      if (!CANDIDATE_TAGS.has(tag)) continue;

      const style = window.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parseFloat(style.opacity || "1") === 0
      ) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      const x = Math.round(rect.left + window.scrollX);
      const y = Math.round(rect.top + window.scrollY);
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);

      if (width < 12 || height < 12) continue;
      if (x + width <= 0 || y >= maxHeight || x >= docWidth) continue;

      const clippedHeight = Math.min(height, maxHeight - Math.max(0, y));
      if (clippedHeight < 12) continue;

      const rawText = node instanceof HTMLElement ? node.innerText : node.textContent || "";
      const text = rawText.replace(/\\s+/g, " ").trim().slice(0, 320);

      const isContainer = tag === "section" || tag === "article" || tag === "main" || tag === "table";
      if (!text && !isContainer) continue;

      const boxKey = x + ":" + y + ":" + width + ":" + clippedHeight + ":" + text.slice(0, 40);
      if (seenBoxes.has(boxKey)) continue;
      seenBoxes.add(boxKey);

      const classList = Array.from(node.classList || [])
        .filter((cls) => cls.length > 0 && cls.length < 48)
        .slice(0, 6);

      const safeX = Math.max(0, x);
      const safeY = Math.max(0, y);

      elements.push({
        id: "el-" + elements.length,
        selector: buildSelector(node),
        tag,
        text,
        boundingBox: {
          x: safeX,
          y: safeY,
          width: Math.min(width, docWidth - safeX),
          height: clippedHeight,
        },
        metadata: {
          idAttr: node.id || null,
          classes: classList,
          role: node.getAttribute("role"),
          ariaLabel: node.getAttribute("aria-label"),
          href: tag === "a" ? node.getAttribute("href") : null,
          domDepth: getDomDepth(node),
        },
      });
    }

    return {
      pageTitle: title,
      documentDimensions: { width: docWidth, height: docHeight },
      elements,
      blockedChallengeSignal: null,
    };
  })()`;

  return (await page.evaluate(script)) as PageExtractionResult;
}
