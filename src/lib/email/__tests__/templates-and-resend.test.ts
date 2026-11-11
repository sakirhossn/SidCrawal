import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResendSend, MockResend } = vi.hoisted(() => {
  const sendFn = vi.fn();
  class FakeResend {
    emails = {
      send: sendFn,
    };
  }
  return { mockResendSend: sendFn, MockResend: FakeResend };
});

vi.mock("resend", () => ({
  Resend: MockResend,
}));

import { ChangeAlertEmailTemplate } from "@/emails/ChangeAlertEmail";
import { MonitorActivatedEmailTemplate } from "@/emails/MonitorActivatedEmail";
import { PasswordResetEmailTemplate } from "@/emails/PasswordResetEmail";
import { VerifyEmailTemplate } from "@/emails/VerifyEmail";
import { WeeklyDigestEmailTemplate } from "@/emails/WeeklyDigestEmail";
import { getResendConfig, renderReactEmail, sendTransactionalEmail } from "../client";
import {
  dispatchQueuedNotificationById,
  sendMonitorActivationNotification,
} from "../notifications";

describe("Phase 5 React Email templates & Resend delivery", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_live_1234567890";
    process.env.EMAIL_FROM = "SidCrawal Alerts <alerts@verify.sidcrawal.example>";
    process.env.NEXT_PUBLIC_APP_URL = "https://sidcrawal.example";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("validates placeholder vs verified domain configuration", () => {
    expect(getResendConfig().configured).toBe(true);
    expect(getResendConfig().isPlaceholderOrSandboxDomain).toBe(false);

    process.env.EMAIL_FROM = "SidCrawal <onboarding@resend.dev>";
    expect(getResendConfig().isPlaceholderOrSandboxDomain).toBe(true);

    process.env.RESEND_API_KEY = "re_your_resend_api_key_placeholder";
    expect(getResendConfig().configured).toBe(false);
  });

  it("renders verification, password reset, activation, digest, and change alert templates cleanly", async () => {
    const stripSsrMarkers = (html: string) => html.replace(/<!--\s*-->/g, "");

    const verifyOut = await renderReactEmail(
      VerifyEmailTemplate({
        recipientName: "Alex Rivera",
        verificationUrl: "https://sidcrawal.example/auth/callback?token_hash=abc&type=signup",
        appUrl: "https://sidcrawal.example",
      })
    );
    expect(stripSsrMarkers(verifyOut.html)).toContain("Confirm your email address");
    expect(verifyOut.html).toContain("max-width: 600px");
    expect(verifyOut.html).toContain("Verify Email Address");
    expect(verifyOut.text).toContain("https://sidcrawal.example/auth/callback");

    const resetOut = await renderReactEmail(
      PasswordResetEmailTemplate({
        recipientName: "Alex Rivera",
        resetUrl: "https://sidcrawal.example/auth/callback?token_hash=xyz&type=recovery",
        appUrl: "https://sidcrawal.example",
      })
    );
    expect(stripSsrMarkers(resetOut.html)).toContain("Reset your SidCrawal password");
    expect(resetOut.html).toContain("Choose New Password");

    const activatedOut = await renderReactEmail(
      MonitorActivatedEmailTemplate({
        monitorId: "mon-1",
        monitorName: "Pricing Monitor",
        targetUrl: "https://example.com/pricing",
        checkIntervalMinutes: 15,
        selectionType: "element",
        selectorLabel: "#pricing-card",
        appUrl: "https://sidcrawal.example",
      })
    );
    expect(stripSsrMarkers(activatedOut.html)).toContain("Monitor activated: Pricing Monitor");
    expect(stripSsrMarkers(activatedOut.html)).toContain("Every 15 minutes");

    const changeOut = await renderReactEmail(
      ChangeAlertEmailTemplate({
        monitorId: "mon-1",
        monitorName: "Pricing Monitor",
        websiteTitle: "Example Pricing",
        websiteUrl: "https://example.com/pricing",
        detectedAt: "Wed, 11 Nov 2026 08:20:00 GMT",
        changeType: "both",
        visualDiffPercentage: 4.0,
        previousText: "Starter $19 / mo",
        currentText: "Pro Scale $49 / mo",
        beforeScreenshotSrc: "cid:before-screenshot",
        afterScreenshotSrc: "cid:after-screenshot",
        diffScreenshotSrc: "cid:diff-screenshot",
        appUrl: "https://sidcrawal.example",
      })
    );
    const changeHtml = stripSsrMarkers(changeOut.html);
    expect(changeHtml).toContain("Example Pricing");
    expect(changeHtml).toContain("https://example.com/pricing");
    expect(changeHtml).toContain("Wed, 11 Nov 2026 08:20:00 GMT");
    expect(changeHtml).toContain("Starter $19 / mo");
    expect(changeHtml).toContain("Pro Scale $49 / mo");
    expect(changeHtml).toContain("4.00% visual difference");
    expect(changeHtml).toContain('src="cid:before-screenshot"');
    expect(changeHtml).toContain('src="cid:after-screenshot"');
    expect(changeHtml).toContain('src="cid:diff-screenshot"');
    expect(changeHtml).toContain("https://sidcrawal.example/dashboard/monitors/mon-1");

    const digestOut = await renderReactEmail(
      WeeklyDigestEmailTemplate({
        recipientName: "Alex",
        periodLabel: "Nov 4 – Nov 11",
        totalActiveMonitors: 2,
        totalChangesDetected: 1,
        items: [
          {
            monitorId: "mon-1",
            monitorName: "Pricing Monitor",
            url: "https://example.com/pricing",
            changesCount: 1,
            lastCheckedAt: "2026-11-11T08:00:00Z",
          },
        ],
        appUrl: "https://sidcrawal.example",
      })
    );
    expect(stripSsrMarkers(digestOut.html)).toContain("Weekly Monitoring Summary");
  });

  it("attaches before/after/diff PNGs with Resend contentId and updates notification status", async () => {
    mockResendSend.mockResolvedValue({
      data: { id: "email_resend_msg_42" },
      error: null,
    });

    const updates: Array<Record<string, unknown>> = [];
    const storageBytes = Buffer.from("png-binary");

    const mockAdminDb = {
      from(table: string) {
        let mode: "select" | "update" = "select";
        let eqId = "";

        const chain = {
          select: () => chain,
          update: (vals: Record<string, unknown>) => {
            mode = "update";
            updates.push({ table, vals });
            return chain;
          },
          eq: (_col: string, val: string) => {
            eqId = val;
            return chain;
          },
          maybeSingle: async () => {
            if (table === "notifications") {
              return {
                data: {
                  id: "notif-1",
                  user_id: "usr-1",
                  monitor_id: "mon-1",
                  detected_change_id: "chg-1",
                  notification_type: "change_alert",
                  recipient_email: "user@example.com",
                  subject: "Change detected on Pricing Watch",
                  status: "queued",
                },
              };
            }
            if (table === "detected_changes") {
              return {
                data: {
                  id: "chg-1",
                  monitor_id: "mon-1",
                  previous_snapshot_id: "snap-1",
                  current_snapshot_id: "snap-2",
                  change_type: "both",
                  visual_diff_percentage: 4.0,
                  diff_screenshot_path: "usr-1/mon-1/run-2/diff.png",
                  previous_text_excerpt: "Starter $19",
                  current_text_excerpt: "Pro $49",
                  detected_at: "2026-11-11T08:20:00.000Z",
                },
              };
            }
            if (table === "monitors") {
              return {
                data: {
                  id: "mon-1",
                  name: "Pricing Watch",
                  url: "https://example.com/pricing",
                },
              };
            }
            if (table === "snapshots") {
              return {
                data: {
                  id: eqId,
                  page_title: "Pricing Watch Page",
                  element_screenshot_path: `usr-1/mon-1/${eqId}/element.png`,
                },
              };
            }
            return { data: null };
          },
          then(resolve: (val: { error: null }) => void) {
            if (mode === "update") return resolve({ error: null });
            return resolve({ error: null });
          },
        };
        return chain;
      },
      storage: {
        from() {
          return {
            download: async () => ({
              data: new Blob([storageBytes]),
              error: null,
            }),
            createSignedUrl: async () => ({ data: null, error: null }),
          };
        },
      },
    };

    const res = await dispatchQueuedNotificationById(
      mockAdminDb as never,
      "notif-1"
    );

    expect(res.status).toBe("sent");
    expect(res.messageId).toBe("email_resend_msg_42");
    expect(mockResendSend).toHaveBeenCalledTimes(1);

    const payload = mockResendSend.mock.calls[0]?.[0];
    expect(payload.from).toBe("SidCrawal Alerts <alerts@verify.sidcrawal.example>");
    expect(payload.to).toBe("user@example.com");
    expect(payload.attachments).toHaveLength(3);
    expect(payload.attachments.map((a: { contentId?: string }) => a.contentId)).toEqual([
      "before-screenshot",
      "after-screenshot",
      "diff-screenshot",
    ]);
    expect(updates[0]?.vals).toMatchObject({
      status: "sent",
      provider_message_id: "email_resend_msg_42",
    });

    // Also test monitor activation email error recording gracefully
    mockResendSend.mockResolvedValueOnce({
      data: null,
      error: { message: "Domain not verified", name: "validation_error" },
    });
    const insertedNotifs: Array<Record<string, unknown>> = [];
    const mockActivationDb = {
      from(table: string) {
        const c = {
          select: () => c,
          eq: () => c,
          gte: () => c,
          order: () => c,
          limit: () => c,
          insert: (vals: Record<string, unknown>) => {
            insertedNotifs.push({ table, vals });
            return Promise.resolve({ error: null });
          },
          maybeSingle: async () => {
            if (table === "monitors") {
              return {
                data: {
                  id: "mon-1",
                  user_id: "usr-1",
                  name: "Pricing",
                  url: "https://example.com",
                  check_interval_minutes: 60,
                },
              };
            }
            if (table === "profiles") return { data: { email: "user@example.com" } };
            if (table === "user_settings") return { data: { email_notifications_enabled: true } };
            if (table === "monitor_selections") {
              return { data: { selection_type: "element", css_selector: "#price", selectors_json: ["#price"] } };
            }
            return { data: null };
          },
        };
        return c;
      },
    };

    await sendMonitorActivationNotification(mockActivationDb as never, "mon-1");
    expect(insertedNotifs[0]?.vals).toMatchObject({
      status: "failed",
      error_message: "Domain not verified",
    });

    // Unconfigured Resend safely skips without crashing
    delete process.env.RESEND_API_KEY;
    const unconfRes = await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Test",
      react: VerifyEmailTemplate({
        verificationUrl: "https://sidcrawal.example/verify",
        appUrl: "https://sidcrawal.example",
      }),
    });
    expect(unconfRes.ok).toBe(false);
    expect(unconfRes.skippedUnconfigured).toBe(true);
  });
});
