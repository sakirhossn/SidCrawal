import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockAdminClient = vi.fn();
const mockServerClient = vi.fn();
const mockProcessNotifications = vi.fn();
const mockSendVerificationResend = vi.fn();
const mockSendResetResend = vi.fn();

vi.mock("@/lib/monitors/auth-guard", () => ({
  requireVerifiedMonitorSession: () => mockRequireSession(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockAdminClient(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mockServerClient(),
}));

vi.mock("@/lib/email/notifications", () => ({
  processQueuedNotifications: (db: unknown, opts: unknown) =>
    mockProcessNotifications(db, opts),
  sendVerificationEmailViaResend: (opts: unknown) =>
    mockSendVerificationResend(opts),
  sendPasswordResetEmailViaResend: (opts: unknown) =>
    mockSendResetResend(opts),
}));

import { POST as forgotPost } from "@/app/api/auth/forgot-password/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as sendNotificationsPost } from "@/app/api/internal/send-notifications/route";
import { GET as notificationsGet } from "@/app/api/notifications/route";

describe("Phase 5 notification & Resend-auth route handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLOUDFLARE_DISPATCH_SECRET = "dispatch-secret-test";
    process.env.RESEND_API_KEY = "re_test_live_1234567890";
    process.env.EMAIL_FROM = "SidCrawal <alerts@verify.sidcrawal.example>";
  });

  it("enforces dispatcher auth on /api/internal/send-notifications and drains queue", async () => {
    const unauthorized = await sendNotificationsPost(
      new Request("http://localhost:3000/api/internal/send-notifications", {
        method: "POST",
      })
    );
    expect(unauthorized.status).toBe(401);

    mockAdminClient.mockReturnValue({});
    mockProcessNotifications.mockResolvedValue({
      processed: 2,
      sent: 2,
      failed: 0,
      skipped: 0,
    });

    const authorized = await sendNotificationsPost(
      new Request("http://localhost:3000/api/internal/send-notifications", {
        method: "POST",
        headers: { Authorization: "Bearer dispatch-secret-test" },
      })
    );
    const json = await authorized.json();
    expect(authorized.status).toBe(200);
    expect(json.sent).toBe(2);
  });

  it("lists RLS-scoped notifications for verified users", async () => {
    mockRequireSession.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            order: () => ({
              limit: async () => ({
                data: [
                  {
                    id: "n-1",
                    notification_type: "change_alert",
                    status: "sent",
                    provider_message_id: "re_msg_1",
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      },
      user: { id: "usr-1" },
    });

    const res = await notificationsGet();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.notifications).toHaveLength(1);
    expect(json.notifications[0].provider_message_id).toBe("re_msg_1");
  });

  it("sends verification & password reset emails via Resend when admin client + Resend are configured", async () => {
    mockServerClient.mockResolvedValue({ auth: {} });
    const generateLink = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          user: { id: "u-new" },
          properties: { hashed_token: "verify_hash_123" },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          user: { id: "u-new", user_metadata: { full_name: "Alex" } },
          properties: { hashed_token: "recovery_hash_456" },
        },
        error: null,
      });

    mockAdminClient.mockReturnValue({
      auth: { admin: { generateLink } },
    });
    mockSendVerificationResend.mockResolvedValue({ ok: true, messageId: "m1" });
    mockSendResetResend.mockResolvedValue({ ok: true, messageId: "m2" });

    const regRes = await registerPost(
      new Request("https://sidcrawal.example/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Alex Rivera",
          email: "alex@example.com",
          password: "Password123!",
        }),
      })
    );
    const regJson = await regRes.json();
    expect(regRes.status).toBe(201);
    expect(regJson.emailProvider).toBe("resend");
    expect(mockSendVerificationResend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alex@example.com",
        verificationUrl: expect.stringContaining("token_hash=verify_hash_123&type=signup"),
      })
    );

    const forgotRes = await forgotPost(
      new Request("https://sidcrawal.example/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alex@example.com" }),
      })
    );
    const forgotJson = await forgotRes.json();
    expect(forgotRes.status).toBe(200);
    expect(forgotJson.emailProvider).toBe("resend");
    expect(mockSendResetResend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alex@example.com",
        resetUrl: expect.stringContaining("token_hash=recovery_hash_456&type=recovery"),
      })
    );
  });
});
