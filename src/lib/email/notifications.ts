import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment } from "resend";
import { ChangeAlertEmailTemplate } from "@/emails/ChangeAlertEmail";
import { MonitorActivatedEmailTemplate } from "@/emails/MonitorActivatedEmail";
import { PasswordResetEmailTemplate } from "@/emails/PasswordResetEmail";
import { VerifyEmailTemplate } from "@/emails/VerifyEmail";
import {
  getAppBaseUrl,
  isResendConfigured,
  sendTransactionalEmail,
} from "./client";

const SNAPSHOT_BUCKET = "monitor-snapshots";
const SIGNED_FALLBACK_TTL_SECONDS = 7 * 24 * 60 * 60;

async function downloadPngFromStorage(
  supabaseAdmin: SupabaseClient,
  path: string | null
): Promise<Buffer | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(SNAPSHOT_BUCKET)
    .download(path);
  if (error || !data) {
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

async function createFallbackSignedUrl(
  supabaseAdmin: SupabaseClient,
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage
    .from(SNAPSHOT_BUCKET)
    .createSignedUrl(path, SIGNED_FALLBACK_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

export async function sendVerificationEmailViaResend(input: {
  to: string;
  recipientName?: string | null;
  verificationUrl: string;
  appUrl?: string;
}) {
  const appUrl = input.appUrl ?? getAppBaseUrl();
  return sendTransactionalEmail({
    to: input.to,
    subject: "Verify your email for SidCrawal",
    react: VerifyEmailTemplate({
      recipientName: input.recipientName,
      verificationUrl: input.verificationUrl,
      appUrl,
    }),
    tags: [{ name: "category", value: "email_verification" }],
  });
}

export async function sendPasswordResetEmailViaResend(input: {
  to: string;
  recipientName?: string | null;
  resetUrl: string;
  appUrl?: string;
}) {
  const appUrl = input.appUrl ?? getAppBaseUrl();
  return sendTransactionalEmail({
    to: input.to,
    subject: "Reset your SidCrawal password",
    react: PasswordResetEmailTemplate({
      recipientName: input.recipientName,
      resetUrl: input.resetUrl,
      appUrl,
    }),
    tags: [{ name: "category", value: "password_reset" }],
  });
}

export interface DispatchNotificationSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Dispatches a single queued `change_alert` notification with inline PNG before/after/diff
 * attachments (plus signed Storage URL fallback) and records the provider result in Postgres.
 */
export async function dispatchQueuedNotificationById(
  supabaseAdmin: SupabaseClient,
  notificationId: string
): Promise<{ status: "sent" | "failed" | "skipped"; messageId: string | null; error?: string | null }> {
  const { data: notif } = await supabaseAdmin
    .from("notifications")
    .select(
      "id, user_id, monitor_id, detected_change_id, notification_type, recipient_email, subject, status"
    )
    .eq("id", notificationId)
    .maybeSingle<{
      id: string;
      user_id: string;
      monitor_id: string | null;
      detected_change_id: string | null;
      notification_type: string;
      recipient_email: string;
      subject: string;
      status: string;
    }>();

  if (!notif || notif.status !== "queued") {
    return { status: "skipped", messageId: null };
  }

  if (!isResendConfigured()) {
    return { status: "skipped", messageId: null, error: "Resend not configured" };
  }

  if (notif.notification_type !== "change_alert" || !notif.detected_change_id || !notif.monitor_id) {
    return { status: "skipped", messageId: null };
  }

  const [{ data: change }, { data: monitor }] = await Promise.all([
    supabaseAdmin
      .from("detected_changes")
      .select(
        "id, monitor_id, previous_snapshot_id, current_snapshot_id, change_type, visual_diff_percentage, diff_screenshot_path, previous_text_excerpt, current_text_excerpt, detected_at"
      )
      .eq("id", notif.detected_change_id)
      .maybeSingle<{
        id: string;
        monitor_id: string;
        previous_snapshot_id: string;
        current_snapshot_id: string;
        change_type: "text" | "visual" | "both";
        visual_diff_percentage: number | null;
        diff_screenshot_path: string | null;
        previous_text_excerpt: string | null;
        current_text_excerpt: string | null;
        detected_at: string;
      }>(),
    supabaseAdmin
      .from("monitors")
      .select("id, name, url")
      .eq("id", notif.monitor_id)
      .maybeSingle<{ id: string; name: string; url: string }>(),
  ]);

  if (!change || !monitor) {
    await supabaseAdmin
      .from("notifications")
      .update({
        status: "failed",
        error_message: "Referenced monitor or detected change record was removed.",
      })
      .eq("id", notif.id);
    return { status: "failed", messageId: null };
  }

  const [{ data: prevSnap }, { data: currSnap }] = await Promise.all([
    supabaseAdmin
      .from("snapshots")
      .select("id, element_screenshot_path")
      .eq("id", change.previous_snapshot_id)
      .maybeSingle<{ id: string; element_screenshot_path: string | null }>(),
    supabaseAdmin
      .from("snapshots")
      .select("id, page_title, element_screenshot_path")
      .eq("id", change.current_snapshot_id)
      .maybeSingle<{
        id: string;
        page_title: string | null;
        element_screenshot_path: string | null;
      }>(),
  ]);

  const [beforeBuf, afterBuf, diffBuf] = await Promise.all([
    downloadPngFromStorage(supabaseAdmin, prevSnap?.element_screenshot_path ?? null),
    downloadPngFromStorage(supabaseAdmin, currSnap?.element_screenshot_path ?? null),
    downloadPngFromStorage(supabaseAdmin, change.diff_screenshot_path),
  ]);

  const attachments: Attachment[] = [];
  let beforeSrc: string | null = null;
  let afterSrc: string | null = null;
  let diffSrc: string | null = null;

  if (beforeBuf) {
    attachments.push({
      filename: "before-screenshot.png",
      content: beforeBuf,
      contentType: "image/png",
      contentId: "before-screenshot",
    });
    beforeSrc = "cid:before-screenshot";
  } else {
    beforeSrc = await createFallbackSignedUrl(
      supabaseAdmin,
      prevSnap?.element_screenshot_path ?? null
    );
  }

  if (afterBuf) {
    attachments.push({
      filename: "after-screenshot.png",
      content: afterBuf,
      contentType: "image/png",
      contentId: "after-screenshot",
    });
    afterSrc = "cid:after-screenshot";
  } else {
    afterSrc = await createFallbackSignedUrl(
      supabaseAdmin,
      currSnap?.element_screenshot_path ?? null
    );
  }

  if (diffBuf) {
    attachments.push({
      filename: "comparison-diff.png",
      content: diffBuf,
      contentType: "image/png",
      contentId: "diff-screenshot",
    });
    diffSrc = "cid:diff-screenshot";
  } else {
    diffSrc = await createFallbackSignedUrl(supabaseAdmin, change.diff_screenshot_path);
  }

  const appUrl = getAppBaseUrl();
  const detectedAtFormatted = new Date(change.detected_at).toUTCString();

  const sendResult = await sendTransactionalEmail({
    to: notif.recipient_email,
    subject: notif.subject,
    attachments,
    react: ChangeAlertEmailTemplate({
      monitorId: monitor.id,
      monitorName: monitor.name,
      websiteTitle: currSnap?.page_title ?? monitor.name,
      websiteUrl: monitor.url,
      detectedAt: detectedAtFormatted,
      changeType: change.change_type,
      visualDiffPercentage: change.visual_diff_percentage,
      previousText: change.previous_text_excerpt ?? "",
      currentText: change.current_text_excerpt ?? "",
      beforeScreenshotSrc: beforeSrc,
      afterScreenshotSrc: afterSrc,
      diffScreenshotSrc: diffSrc,
      appUrl,
    }),
    tags: [{ name: "category", value: "change_alert" }],
  });

  if (sendResult.ok) {
    await supabaseAdmin
      .from("notifications")
      .update({
        status: "sent",
        provider_message_id: sendResult.messageId,
        sent_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", notif.id);
    return { status: "sent", messageId: sendResult.messageId };
  }

  await supabaseAdmin
    .from("notifications")
    .update({
      status: "failed",
      error_message: (sendResult.error ?? "Email send failed").slice(0, 500),
    })
    .eq("id", notif.id);

  return { status: "failed", messageId: null, error: sendResult.error };
}

/**
 * Drains queued change-alert notifications up to `limit`.
 */
export async function processQueuedNotifications(
  supabaseAdmin: SupabaseClient,
  options?: { limit?: number; detectedChangeId?: string }
): Promise<DispatchNotificationSummary> {
  if (!isResendConfigured()) {
    return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  }

  let query = supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(options?.limit ?? 20);

  if (options?.detectedChangeId) {
    query = query.eq("detected_change_id", options.detectedChangeId);
  }

  const { data: queuedRows } = await query;
  const rows = (queuedRows ?? []) as Array<{ id: string }>;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const res = await dispatchQueuedNotificationById(supabaseAdmin, row.id);
    if (res.status === "sent") sent += 1;
    else if (res.status === "failed") failed += 1;
    else skipped += 1;
  }

  return {
    processed: rows.length,
    sent,
    failed,
    skipped,
  };
}

/**
 * Sends a monitor activation confirmation email once per 24h activation window.
 */
export async function sendMonitorActivationNotification(
  supabaseAdmin: SupabaseClient,
  monitorId: string
): Promise<void> {
  const { data: monitor } = await supabaseAdmin
    .from("monitors")
    .select("id, user_id, name, url, check_interval_minutes")
    .eq("id", monitorId)
    .maybeSingle<{
      id: string;
      user_id: string;
      name: string;
      url: string;
      check_interval_minutes: number;
    }>();

  if (!monitor) return;

  const [{ data: profile }, { data: settings }, { data: selection }, { data: recentActivation }] =
    await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", monitor.user_id)
        .maybeSingle<{ email: string }>(),
      supabaseAdmin
        .from("user_settings")
        .select("email_notifications_enabled")
        .eq("user_id", monitor.user_id)
        .maybeSingle<{ email_notifications_enabled: boolean }>(),
      supabaseAdmin
        .from("monitor_selections")
        .select("selection_type, css_selector, selectors_json")
        .eq("monitor_id", monitor.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
          selection_type: string;
          css_selector: string | null;
          selectors_json: string[];
        }>(),
      supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("monitor_id", monitor.id)
        .eq("notification_type", "activation")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
        .limit(1)
        .maybeSingle<{ id: string }>(),
    ]);

  if (!profile?.email || settings?.email_notifications_enabled === false || recentActivation) {
    return;
  }

  const subject = `Monitoring activated for ${monitor.name}`;
  const selectorLabel =
    selection?.selection_type === "region"
      ? "Visual bounding-box region"
      : selection?.css_selector || selection?.selectors_json?.[0] || "Selected element";

  if (!isResendConfigured()) {
    await supabaseAdmin.from("notifications").insert({
      user_id: monitor.user_id,
      monitor_id: monitor.id,
      notification_type: "activation",
      recipient_email: profile.email,
      subject,
      status: "queued",
    });
    return;
  }

  const sendResult = await sendTransactionalEmail({
    to: profile.email,
    subject,
    react: MonitorActivatedEmailTemplate({
      monitorId: monitor.id,
      monitorName: monitor.name,
      targetUrl: monitor.url,
      checkIntervalMinutes: monitor.check_interval_minutes,
      selectionType: selection?.selection_type ?? "element",
      selectorLabel,
      appUrl: getAppBaseUrl(),
    }),
    tags: [{ name: "category", value: "activation" }],
  });

  await supabaseAdmin.from("notifications").insert({
    user_id: monitor.user_id,
    monitor_id: monitor.id,
    notification_type: "activation",
    recipient_email: profile.email,
    subject,
    status: sendResult.ok ? "sent" : "failed",
    provider_message_id: sendResult.messageId,
    error_message: sendResult.error,
    sent_at: sendResult.ok ? new Date().toISOString() : null,
  });
}
