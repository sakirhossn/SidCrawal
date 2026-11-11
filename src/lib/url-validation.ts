import {
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
} from "./ip-ranges";

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  host?: string;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

/**
 * Performs syntactic and literal-IP SSRF pre-validation for monitor target URLs.
 * Full DNS resolution and redirect hop inspection run server-side before navigation.
 */
export function validateTargetUrl(rawInput: string): UrlValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, reason: "Enter a website URL to inspect." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      reason: "Enter a valid URL starting with https:// or http://.",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      valid: false,
      reason: "Only http:// and https:// URLs are permitted.",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      reason: "Embedded credentials in URLs are not allowed.",
    };
  }

  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return {
      valid: false,
      reason: "Only standard HTTP (80) and HTTPS (443) ports are allowed.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateOrReservedIpv4(host) ||
    isPrivateOrReservedIpv6(host)
  ) {
    return {
      valid: false,
      reason: "Localhost, internal hostnames, and private IP ranges are blocked.",
    };
  }

  if (!host.includes(".") && !host.includes(":")) {
    return {
      valid: false,
      reason: "Target host must be a publicly routable domain name.",
    };
  }

  parsed.hash = "";
  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    host,
  };
}
