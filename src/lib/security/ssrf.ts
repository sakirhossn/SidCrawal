import dns from "node:dns/promises";
import net from "node:net";
import { isPrivateOrReservedIp } from "@/lib/ip-ranges";
import { validateTargetUrl } from "@/lib/url-validation";

export interface SsrfValidationResult {
  ok: boolean;
  normalizedUrl?: string;
  host?: string;
  resolvedIps?: string[];
  code?: "INVALID_URL" | "SSRF_BLOCKED_TARGET" | "DNS_RESOLUTION_FAILED";
  reason?: string;
}

/**
 * Full server-side SSRF validation:
 * 1. Validates syntax, scheme, port, credentials, and literal private IPs.
 * 2. Resolves DNS A/AAAA records and rejects any private/reserved/metadata IP.
 */
export async function validatePublicTargetWithDns(
  rawUrl: string
): Promise<SsrfValidationResult> {
  const syntax = validateTargetUrl(rawUrl);
  if (!syntax.valid || !syntax.normalizedUrl || !syntax.host) {
    const isBlocked = syntax.reason?.toLowerCase().includes("blocked");
    return {
      ok: false,
      code: isBlocked ? "SSRF_BLOCKED_TARGET" : "INVALID_URL",
      reason: syntax.reason ?? "Enter a valid public website URL.",
    };
  }

  const host = syntax.host.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      return {
        ok: false,
        code: "SSRF_BLOCKED_TARGET",
        reason: "Target IP address falls inside a private or reserved network range.",
      };
    }
    return {
      ok: true,
      normalizedUrl: syntax.normalizedUrl,
      host,
      resolvedIps: [host],
    };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      return {
        ok: false,
        code: "DNS_RESOLUTION_FAILED",
        reason: `Could not resolve DNS records for ${host}.`,
      };
    }

    const ips = records.map((r) => r.address);
    for (const ip of ips) {
      if (isPrivateOrReservedIp(ip)) {
        return {
          ok: false,
          code: "SSRF_BLOCKED_TARGET",
          reason: `Target ${host} resolved to a blocked private or internal network address.`,
        };
      }
    }

    return {
      ok: true,
      normalizedUrl: syntax.normalizedUrl,
      host,
      resolvedIps: ips,
    };
  } catch {
    return {
      ok: false,
      code: "DNS_RESOLUTION_FAILED",
      reason: `Unable to resolve hostname "${host}". Verify the domain name is public and reachable.`,
    };
  }
}
