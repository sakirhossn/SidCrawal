interface SupabaseLikeError {
  code?: string;
  message?: string;
  status?: number;
}

const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "Incorrect email or password. Double-check your credentials or reset your password.",
  email_not_confirmed:
    "Your email address is not verified yet. Check your inbox or request a new verification link.",
  user_already_exists:
    "An account with this email already exists. Try signing in or resetting your password.",
  email_exists:
    "An account with this email already exists. Try signing in or resetting your password.",
  over_email_send_rate_limit:
    "Too many authentication emails were requested recently. Wait a minute before trying again.",
  over_request_rate_limit:
    "Too many requests in a short period. Please wait a moment and try again.",
  weak_password:
    "Choose a stronger password with at least 8 characters including letters and numbers.",
  same_password:
    "Your new password must be different from your current password.",
  otp_expired:
    "This verification or reset link has expired. Request a new link to continue.",
  flow_state_expired:
    "This authentication link expired before completion. Please request a fresh link.",
  flow_state_not_found:
    "This authentication link is no longer valid. Please start the request again.",
  session_not_found:
    "Your session is no longer active. Sign in again to continue.",
  signup_disabled:
    "New account registration is currently disabled on this workspace.",
  email_address_invalid: "Enter a valid email address.",
};

function extractErrorFields(error: unknown): SupabaseLikeError {
  if (!error || typeof error !== "object") {
    return { message: typeof error === "string" ? error : undefined };
  }
  const err = error as Record<string, unknown>;
  return {
    code: typeof err.code === "string" ? err.code : undefined,
    message: typeof err.message === "string" ? err.message : undefined,
    status: typeof err.status === "number" ? err.status : undefined,
  };
}

export function isEmailNotConfirmedError(error: unknown): boolean {
  const { code, message } = extractErrorFields(error);
  if (code === "email_not_confirmed") {
    return true;
  }
  return Boolean(
    message && message.toLowerCase().includes("email not confirmed")
  );
}

/**
 * Translates Supabase Auth and network errors into concise, user-actionable messages
 * without leaking raw server internals.
 */
export function formatAuthError(
  error: unknown,
  fallback = "Unable to complete your authentication request. Please try again."
): string {
  const { code, message, status } = extractErrorFields(error);

  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }

  if (message) {
    const lower = message.toLowerCase();
    if (lower.includes("invalid login credentials")) {
      return CODE_MESSAGES.invalid_credentials;
    }
    if (lower.includes("email not confirmed")) {
      return CODE_MESSAGES.email_not_confirmed;
    }
    if (
      lower.includes("user already registered") ||
      lower.includes("already been registered")
    ) {
      return CODE_MESSAGES.user_already_exists;
    }
    if (lower.includes("rate limit") || status === 429) {
      return CODE_MESSAGES.over_email_send_rate_limit;
    }
    if (lower.includes("expired") || lower.includes("invalid token")) {
      return CODE_MESSAGES.otp_expired;
    }
    if (lower.includes("different from the old password")) {
      return CODE_MESSAGES.same_password;
    }
    if (lower.includes("password should be at least")) {
      return CODE_MESSAGES.weak_password;
    }
    if (lower.includes("failed to fetch") || lower.includes("network")) {
      return "Unable to reach the authentication service. Check your internet connection and try again.";
    }
  }

  return fallback;
}
