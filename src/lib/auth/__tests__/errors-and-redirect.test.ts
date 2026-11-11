import { describe, expect, it } from "vitest";
import { formatAuthError, isEmailNotConfirmedError } from "../errors";
import { sanitizeRedirectPath } from "../redirect";
import {
  registerSchema,
  resetPasswordSchema,
  updateSettingsSchema,
} from "../schemas";

describe("formatAuthError", () => {
  it("maps known Supabase error codes to helpful messages", () => {
    expect(formatAuthError({ code: "invalid_credentials" })).toMatch(
      /Incorrect email or password/i
    );
    expect(formatAuthError({ code: "email_not_confirmed" })).toMatch(
      /not verified yet/i
    );
    expect(formatAuthError({ code: "over_email_send_rate_limit" })).toMatch(
      /Too many authentication emails/i
    );
    expect(formatAuthError({ code: "otp_expired" })).toMatch(/expired/i);
  });

  it("maps known error messages and detects email_not_confirmed", () => {
    const err = { message: "Email not confirmed" };
    expect(isEmailNotConfirmedError(err)).toBe(true);
    expect(formatAuthError(err)).toMatch(/not verified yet/i);
    expect(formatAuthError({ message: "Failed to fetch" })).toMatch(
      /authentication service/i
    );
  });
});

describe("sanitizeRedirectPath", () => {
  it("blocks external and protocol-relative redirects", () => {
    expect(sanitizeRedirectPath("https://evil.example/steal")).toBe("/dashboard");
    expect(sanitizeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/\\evil.example")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/dashboard\nLocation: evil")).toBe("/dashboard");
  });

  it("preserves safe relative paths with query strings", () => {
    expect(sanitizeRedirectPath("/dashboard/settings?tab=profile")).toBe(
      "/dashboard/settings?tab=profile"
    );
  });
});

describe("auth schemas", () => {
  it("validates register inputs and reset password match", () => {
    expect(
      registerSchema.safeParse({
        fullName: "A",
        email: "bad",
        password: "short",
      }).success
    ).toBe(false);

    const mismatch = resetPasswordSchema.safeParse({
      password: "StrongPassword123",
      confirmPassword: "DifferentPassword123",
    });
    expect(mismatch.success).toBe(false);

    expect(
      updateSettingsSchema.safeParse({
        fullName: "Alex Rivera",
        defaultCheckIntervalMinutes: 60,
        emailNotificationsEnabled: true,
        weeklyDigestEnabled: false,
        timezone: "UTC",
        themePreference: "dark",
      }).success
    ).toBe(true);
  });
});
