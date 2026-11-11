import crypto from "node:crypto";

const PLACEHOLDER_MARKERS = ["placeholder", "your-"];

export function isConfiguredSecret(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((m) => lower.includes(m));
}

/**
 * Constant-time Bearer token check used by internal scheduler and worker callback endpoints.
 */
export function verifyBearerSecret(
  authHeader: string | null,
  expectedSecret: string | undefined
): boolean {
  if (!isConfiguredSecret(expectedSecret)) {
    return false;
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const provided = Buffer.from(authHeader.slice("Bearer ".length).trim());
  const expected = Buffer.from(expectedSecret.trim());
  if (provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}
