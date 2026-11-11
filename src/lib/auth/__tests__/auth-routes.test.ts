import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const mockCreateServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mockCreateServerClient(),
}));

import { GET as callbackGet } from "@/app/auth/callback/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as forgotPost } from "@/app/api/auth/forgot-password/route";
import { POST as resetPost } from "@/app/api/auth/reset-password/route";
import { POST as resendPost } from "@/app/api/auth/resend-verification/route";
import { GET as settingsGet, PATCH as settingsPatch } from "@/app/api/settings/route";

function makeVerifiedUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-123",
    aud: "authenticated",
    role: "authenticated",
    email: "alex@example.com",
    email_confirmed_at: "2026-11-10T10:00:00.000Z",
    phone: "",
    confirmed_at: "2026-11-10T10:00:00.000Z",
    last_sign_in_at: "2026-11-10T10:00:00.000Z",
    app_metadata: {},
    user_metadata: { full_name: "Alex Rivera" },
    identities: [
      {
        id: "identity-1",
        identity_id: "identity-1",
        user_id: "user-123",
        identity_data: { email: "alex@example.com" },
        provider: "email",
        created_at: "2026-11-10T09:00:00.000Z",
        updated_at: "2026-11-10T09:00:00.000Z",
        last_sign_in_at: "2026-11-10T09:00:00.000Z",
      },
    ],
    created_at: "2026-11-10T09:00:00.000Z",
    updated_at: "2026-11-10T10:00:00.000Z",
    is_anonymous: false,
    ...overrides,
  };
}

function createMockSupabase() {
  const profileRow = {
    id: "user-123",
    email: "alex@example.com",
    full_name: "Alex Rivera",
    role: "user",
    email_verified_at: "2026-11-10T10:00:00.000Z",
    created_at: "2026-11-10T09:00:00.000Z",
    updated_at: "2026-11-10T10:00:00.000Z",
  };
  const settingsRow = {
    user_id: "user-123",
    default_check_interval_minutes: 60,
    email_notifications_enabled: true,
    weekly_digest_enabled: false,
    timezone: "UTC",
    theme_preference: "system",
  };
  const limitsRow = {
    user_id: "user-123",
    plan_tier: "free",
    max_monitors: 5,
    min_interval_minutes: 60,
    max_monthly_crawls: 2000,
    current_month_crawls: 0,
    quota_reset_at: "2026-12-01T00:00:00.000Z",
  };

  const auth = {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    resend: vi.fn().mockResolvedValue({ error: null }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({
      data: { user: makeVerifiedUser() },
      error: null,
    }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: makeVerifiedUser() }, error: null }),
  };

  const from = vi.fn((table: string) => {
    const rowForTable =
      table === "profiles"
        ? profileRow
        : table === "user_settings"
          ? settingsRow
          : limitsRow;

    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: rowForTable, error: null }),
        }),
      }),
      upsert: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: rowForTable, error: null }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: rowForTable, error: null }),
          }),
          then: (resolve: (val: { error: null }) => void) =>
            resolve({ error: null }),
        }),
      }),
    };
  });

  return { auth, from };
}

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Auth & Settings Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 when Supabase is not configured", async () => {
    mockCreateServerClient.mockResolvedValue(null);
    const res = await loginPost(
      jsonRequest("http://localhost:3000/api/auth/login", {
        email: "alex@example.com",
        password: "Password123!",
      })
    );
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.code).toBe("SUPABASE_UNCONFIGURED");
  });

  it("registers a new user and requires email verification", async () => {
    const mockSupabase = createMockSupabase();
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { user: makeVerifiedUser({ email_confirmed_at: undefined }), session: null },
      error: null,
    });
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const res = await registerPost(
      jsonRequest("http://localhost:3000/api/auth/register", {
        fullName: "Alex Rivera",
        email: "alex@example.com",
        password: "Password123!",
      })
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.requiresEmailVerification).toBe(true);
  });

  it("returns 409 when Supabase returns empty identities for duplicate account", async () => {
    const mockSupabase = createMockSupabase();
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { user: makeVerifiedUser({ identities: [] }), session: null },
      error: null,
    });
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const res = await registerPost(
      jsonRequest("http://localhost:3000/api/auth/register", {
        fullName: "Alex Rivera",
        email: "alex@example.com",
        password: "Password123!",
      })
    );
    expect(res.status).toBe(409);
  });

  it("rejects unverified user on login and signs them out cleanly", async () => {
    const mockSupabase = createMockSupabase();
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: makeVerifiedUser({ email_confirmed_at: undefined }),
        session: {},
      },
      error: null,
    });
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const res = await loginPost(
      jsonRequest("http://localhost:3000/api/auth/login", {
        email: "alex@example.com",
        password: "Password123!",
      })
    );

    expect(res.status).toBe(403);
    expect(mockSupabase.auth.signOut).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.error.code).toBe("EMAIL_NOT_CONFIRMED");
  });

  it("logs in verified user, ensures profile, and sanitizes redirect", async () => {
    const mockSupabase = createMockSupabase();
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: makeVerifiedUser(), session: {} },
      error: null,
    });
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const res = await loginPost(
      jsonRequest("http://localhost:3000/api/auth/login", {
        email: "alex@example.com",
        password: "Password123!",
        next: "https://evil.example",
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.redirectTo).toBe("/dashboard");
  });

  it("exchanges PKCE code and handles token_hash verification in /auth/callback", async () => {
    const mockSupabase = createMockSupabase();
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const pkceRes = await callbackGet(
      new Request("http://localhost:3000/auth/callback?code=abc123&next=/dashboard/settings")
    );
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(pkceRes.headers.get("location")).toBe(
      "http://localhost:3000/dashboard/settings?verified=1"
    );

    const otpRes = await callbackGet(
      new Request(
        "http://localhost:3000/auth/callback?token_hash=tok123&type=recovery&next=//evil.com"
      )
    );
    expect(mockSupabase.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "tok123",
      type: "recovery",
    });
    expect(otpRes.headers.get("location")).toBe(
      "http://localhost:3000/reset-password"
    );
  });

  it("handles forgot-password, reset-password, resend-verification, and logout", async () => {
    const mockSupabase = createMockSupabase();
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const forgotRes = await forgotPost(
      jsonRequest("http://localhost:3000/api/auth/forgot-password", {
        email: "alex@example.com",
      })
    );
    expect(forgotRes.status).toBe(200);

    const resendRes = await resendPost(
      jsonRequest("http://localhost:3000/api/auth/resend-verification", {
        email: "alex@example.com",
      })
    );
    expect(resendRes.status).toBe(200);

    const resetRes = await resetPost(
      jsonRequest("http://localhost:3000/api/auth/reset-password", {
        password: "NewPassword123!",
        confirmPassword: "NewPassword123!",
      })
    );
    expect(resetRes.status).toBe(200);
    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
      password: "NewPassword123!",
    });

    const logoutRes = await logoutPost();
    expect(logoutRes.status).toBe(200);
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });

  it("rejects reset-password when recovery session is missing", async () => {
    const mockSupabase = createMockSupabase();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const res = await resetPost(
      jsonRequest("http://localhost:3000/api/auth/reset-password", {
        password: "NewPassword123!",
        confirmPassword: "NewPassword123!",
      })
    );
    expect(res.status).toBe(401);
  });

  it("protects /api/settings and enforces min_interval_minutes quota", async () => {
    const mockSupabase = createMockSupabase();
    mockCreateServerClient.mockResolvedValue(mockSupabase);

    const getOk = await settingsGet();
    expect(getOk.status).toBe(200);

    const patchTooFast = await settingsPatch(
      jsonRequest(
        "http://localhost:3000/api/settings",
        {
          fullName: "Alex Rivera",
          defaultCheckIntervalMinutes: 5,
          emailNotificationsEnabled: true,
          weeklyDigestEnabled: false,
          timezone: "UTC",
          themePreference: "dark",
        },
        "PATCH"
      )
    );
    expect(patchTooFast.status).toBe(400);

    const patchOk = await settingsPatch(
      jsonRequest(
        "http://localhost:3000/api/settings",
        {
          fullName: "Alex Rivera",
          defaultCheckIntervalMinutes: 60,
          emailNotificationsEnabled: true,
          weeklyDigestEnabled: true,
          timezone: "America/New_York",
          themePreference: "dark",
        },
        "PATCH"
      )
    );
    expect(patchOk.status).toBe(200);

    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const unauth = await settingsGet();
    expect(unauth.status).toBe(401);
  });
});
