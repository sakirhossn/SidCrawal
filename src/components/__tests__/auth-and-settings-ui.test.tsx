import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthForm } from "@/components/auth/auth-form";
import { SettingsForm } from "@/components/dashboard/settings-form";

const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    setTheme: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  mockSearchParams = new URLSearchParams();
  vi.restoreAllMocks();
});

describe("AuthForm UI", () => {
  it("shows validation error on invalid login inputs", () => {
    render(<AuthForm mode="login" supabaseConfigured={true} />);
    fireEvent.click(screen.getByRole("button", { name: /Sign in to Dashboard/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/Email address is required/i);
  });

  it("shows resend verification shortcut when login returns EMAIL_NOT_CONFIRMED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "EMAIL_NOT_CONFIRMED",
            message: "Verify your email address first.",
          },
        }),
        { status: 403 }
      )
    );

    render(<AuthForm mode="login" supabaseConfigured={true} />);
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Sign in to Dashboard/i }));

    await waitFor(() => {
      expect(screen.getByText(/Resend verification email/i)).toBeDefined();
    });
  });

  it("displays check-inbox view after registration requiring verification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          requiresEmailVerification: true,
          message: "Account created. Check your inbox.",
        }),
        { status: 201 }
      )
    );

    render(<AuthForm mode="register" supabaseConfigured={true} />);
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Alex Rivera" },
    });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create Account/i }));

    await waitFor(() => {
      expect(screen.getByText(/Verify alex@example.com/i)).toBeDefined();
    });
  });

  it("shows expired-link fallback on reset-password when no recovery session exists", () => {
    render(
      <AuthForm
        mode="reset-password"
        supabaseConfigured={true}
        hasRecoverySession={false}
      />
    );
    expect(screen.getByRole("alert").textContent).toMatch(/missing, invalid, or expired/i);
  });
});

describe("SettingsForm UI", () => {
  it("submits updated profile and notification settings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          message: "Profile and monitor defaults saved.",
        }),
        { status: 200 }
      )
    );

    render(
      <SettingsForm
        configured={true}
        authenticated={true}
        profile={{
          id: "u1",
          email: "alex@example.com",
          full_name: "Alex",
          role: "user",
          email_verified_at: "2026-11-10T10:00:00Z",
          created_at: "2026-11-10T10:00:00Z",
          updated_at: "2026-11-10T10:00:00Z",
        }}
        settings={{
          user_id: "u1",
          default_check_interval_minutes: 60,
          email_notifications_enabled: true,
          weekly_digest_enabled: false,
          timezone: "UTC",
          theme_preference: "system",
        }}
        usageLimits={{
          user_id: "u1",
          plan_tier: "free",
          max_monitors: 5,
          min_interval_minutes: 60,
          max_monthly_crawls: 2000,
          current_month_crawls: 0,
          quota_reset_at: "2026-12-01T00:00:00Z",
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Alex Rivera" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Settings/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({ method: "PATCH" })
      );
      expect(screen.getByRole("status").textContent).toMatch(
        /Profile and monitor defaults saved/i
      );
    });
  });
});
