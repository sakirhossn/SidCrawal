import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLookup = vi.fn();

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: (...args: unknown[]) => mockLookup(...args),
  },
}));

import { validatePublicTargetWithDns } from "../ssrf";

describe("validatePublicTargetWithDns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts domains resolving strictly to public IP addresses", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const res = await validatePublicTargetWithDns("https://example.com/pricing#top");
    expect(res.ok).toBe(true);
    expect(res.normalizedUrl).toBe("https://example.com/pricing");
    expect(res.resolvedIps).toEqual(["93.184.216.34"]);
  });

  it("blocks domains resolving to loopback, RFC1918, metadata, or IPv6 private IPs", async () => {
    const privateIps = [
      "127.0.0.1",
      "10.12.0.5",
      "172.16.8.1",
      "192.168.10.20",
      "169.254.169.254",
      "::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ];

    for (const ip of privateIps) {
      mockLookup.mockResolvedValue([{ address: ip, family: ip.includes(":") ? 6 : 4 }]);
      const res = await validatePublicTargetWithDns("https://rebind.attacker.test");
      expect(res.ok, `Expected ${ip} to be blocked`).toBe(false);
      expect(res.code).toBe("SSRF_BLOCKED_TARGET");
    }
  });

  it("returns DNS_RESOLUTION_FAILED when lookup throws", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    const res = await validatePublicTargetWithDns("https://nonexistent.invalid");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("DNS_RESOLUTION_FAILED");
  });
});
