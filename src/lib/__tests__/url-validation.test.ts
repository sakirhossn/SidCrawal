import { describe, expect, it } from "vitest";
import { validateTargetUrl } from "../url-validation";

describe("validateTargetUrl", () => {
  it("accepts public https and http URLs and strips hash fragments", () => {
    const res = validateTargetUrl("  https://example.com/pricing#tier-pro ");
    expect(res.valid).toBe(true);
    expect(res.normalizedUrl).toBe("https://example.com/pricing");
    expect(res.host).toBe("example.com");
  });

  it("rejects non-http schemes", () => {
    expect(validateTargetUrl("file:///etc/passwd").valid).toBe(false);
    expect(validateTargetUrl("javascript:alert(1)").valid).toBe(false);
    expect(validateTargetUrl("ftp://example.com/file").valid).toBe(false);
  });

  it("rejects embedded credentials and non-standard ports", () => {
    expect(validateTargetUrl("https://user:pass@example.com").valid).toBe(false);
    expect(validateTargetUrl("https://example.com:8443/admin").valid).toBe(false);
  });

  it("blocks localhost, internal hostnames, and private IP ranges", () => {
    const blockedTargets = [
      "http://localhost:3000",
      "http://127.0.0.1/status",
      "http://10.0.0.5/internal",
      "http://172.16.4.12/health",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://metadata.google.internal/",
      "http://service.local/",
    ];

    for (const target of blockedTargets) {
      const result = validateTargetUrl(target);
      expect(result.valid, `Expected ${target} to be rejected`).toBe(false);
    }
  });
});
