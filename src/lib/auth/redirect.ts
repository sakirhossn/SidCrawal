const DEFAULT_REDIRECT = "/dashboard";

/**
 * Restricts post-auth redirects to internal relative paths to prevent open-redirect attacks.
 */
export function sanitizeRedirectPath(
  nextPath: string | null | undefined,
  fallback = DEFAULT_REDIRECT
): string {
  if (!nextPath) {
    return fallback;
  }

  const trimmed = nextPath.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\r") ||
    trimmed.includes("\n")
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function getOriginFromRequest(request: Request): string {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredAppUrl && !configuredAppUrl.includes("placeholder")) {
    try {
      return new URL(configuredAppUrl).origin;
    } catch {
      // fall back to request URL origin
    }
  }
  return new URL(request.url).origin;
}
