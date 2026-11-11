import crypto from "node:crypto";

export type ChangeType = "text" | "visual" | "both";

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Generates a deterministic fingerprint for a detected change state so identical
 * consecutive alerts or replayed crawl submissions are deduplicated safely.
 */
export function computeChangeFingerprint(input: {
  monitorId: string;
  contentHash: string;
  changeType: ChangeType;
  visualDiffPercentage: number;
}): string {
  const visualBucket =
    input.changeType === "text"
      ? "text-only"
      : String(Math.round(input.visualDiffPercentage));

  return sha256Hex(
    [input.monitorId, input.contentHash, input.changeType, visualBucket].join("|")
  );
}

/**
 * Builds two concise normalized excerpts around the differing portion of previous vs. current text.
 */
export function buildTextDiffSummary(previousText: string, currentText: string): {
  previousExcerpt: string;
  currentExcerpt: string;
  previousLength: number;
  currentLength: number;
  changed: boolean;
} {
  const prev = previousText ?? "";
  const curr = currentText ?? "";
  if (prev === curr) {
    return {
      previousExcerpt: prev.slice(0, 280),
      currentExcerpt: curr.slice(0, 280),
      previousLength: prev.length,
      currentLength: curr.length,
      changed: false,
    };
  }

  let prefixLen = 0;
  const maxPrefix = Math.min(prev.length, curr.length);
  while (prefixLen < maxPrefix && prev[prefixLen] === curr[prefixLen]) {
    prefixLen += 1;
  }

  const contextStart = Math.max(0, prefixLen - 40);
  const prevExcerpt =
    (contextStart > 0 ? "..." : "") + prev.slice(contextStart, contextStart + 320);
  const currExcerpt =
    (contextStart > 0 ? "..." : "") + curr.slice(contextStart, contextStart + 320);

  return {
    previousExcerpt: prevExcerpt.slice(0, 400),
    currentExcerpt: currExcerpt.slice(0, 400),
    previousLength: prev.length,
    currentLength: curr.length,
    changed: true,
  };
}
