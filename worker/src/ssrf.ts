import dns from "node:dns/promises";
import net from "node:net";
import { isPrivateOrReservedIp } from "../../src/lib/ip-ranges.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

export interface WorkerSsrfResult {
  ok: boolean;
  code?: "INVALID_URL" | "SSRF_BLOCKED_TARGET" | "DNS_RESOLUTION_FAILED";
  reason?: string;
  normalizedUrl?: string;
  resolvedIps?: string[];
}

export async function validateWorkerTargetUrl(
  rawUrl: string
): Promise<WorkerSsrfResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      reason: "Enter a valid URL starting with https:// or http://.",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      code: "INVALID_URL",
      reason: "Only http:// and https:// URLs are permitted.",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: "INVALID_URL",
      reason: "Embedded credentials in URLs are not allowed.",
    };
  }

  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return {
      ok: false,
      code: "INVALID_URL",
      reason: "Only standard HTTP (80) and HTTPS (443) ports are allowed.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  const cleanIp = host.replace(/^\[|\]$/g, "");

  if (
    !host ||
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return {
      ok: false,
      code: "SSRF_BLOCKED_TARGET",
      reason: "Localhost and internal hostnames are blocked.",
    };
  }

  if (net.isIP(cleanIp)) {
    if (isPrivateOrReservedIp(cleanIp)) {
      return {
        ok: false,
        code: "SSRF_BLOCKED_TARGET",
        reason: "Target IP address falls inside a private or reserved network range.",
      };
    }
    parsed.hash = "";
    return { ok: true, normalizedUrl: parsed.toString(), resolvedIps: [cleanIp] };
  }

  if (!host.includes(".")) {
    return {
      ok: false,
      code: "INVALID_URL",
      reason: "Target host must be a publicly routable domain name.",
    };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      return {
        ok: false,
        code: "DNS_RESOLUTION_FAILED",
        reason: `No DNS records found for ${host}.`,
      };
    }
    const ips = records.map((r) => r.address);
    for (const ip of ips) {
      if (isPrivateOrReservedIp(ip)) {
        return {
          ok: false,
          code: "SSRF_BLOCKED_TARGET",
          reason: `Target ${host} resolved to a private or reserved address.`,
        };
      }
    }
    parsed.hash = "";
    return { ok: true, normalizedUrl: parsed.toString(), resolvedIps: ips };
  } catch {
    return {
      ok: false,
      code: "DNS_RESOLUTION_FAILED",
      reason: `Could not resolve DNS for ${host}.`,
    };
  }
}
