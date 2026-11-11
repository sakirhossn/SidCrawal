export interface NormalizationRules {
  collapseWhitespace?: boolean;
  ignoreNumbers?: boolean;
  stripTimestamps?: boolean;
  ignoreRegexPatterns?: string[];
  visualDiffThresholdPercent?: number;
}

const MAX_REGEX_PATTERNS = 5;
const MAX_REGEX_LENGTH = 120;

const ISO_TIMESTAMP_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gi;
const CLOCK_TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|UTC|GMT)?\b/gi;
const RELATIVE_TIME_RE =
  /\b(?:\d+\s+(?:second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months)\s+ago|just now)\b/gi;

/**
 * Applies deterministic dynamic-content normalization rules to extracted element or region text
 * before content hashing and diff comparison.
 */
export function normalizeExtractedText(
  rawText: string,
  rules: NormalizationRules = {}
): string {
  let result = rawText ?? "";

  if (Array.isArray(rules.ignoreRegexPatterns)) {
    const safePatterns = rules.ignoreRegexPatterns.slice(0, MAX_REGEX_PATTERNS);
    for (const pattern of safePatterns) {
      if (typeof pattern !== "string" || !pattern || pattern.length > MAX_REGEX_LENGTH) {
        continue;
      }
      try {
        const re = new RegExp(pattern, "g");
        result = result.replace(re, "[ignored]");
      } catch {
        // Skip invalid user regex pattern rather than crashing the crawl
      }
    }
  }

  if (rules.stripTimestamps) {
    result = result
      .replace(ISO_TIMESTAMP_RE, "[timestamp]")
      .replace(RELATIVE_TIME_RE, "[relative-time]")
      .replace(CLOCK_TIME_RE, "[time]");
  }

  if (rules.ignoreNumbers) {
    result = result.replace(/\d+/g, "#");
  }

  if (rules.collapseWhitespace !== false) {
    result = result.replace(/\s+/g, " ").trim();
  }

  return result;
}

export function getVisualDiffThreshold(rules: NormalizationRules = {}): number {
  const val = rules.visualDiffThresholdPercent;
  if (typeof val !== "number" || !Number.isFinite(val)) {
    return 0.5;
  }
  return Math.min(Math.max(val, 0), 100);
}
