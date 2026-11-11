import { render } from "@react-email/components";
import type * as React from "react";
import { type Attachment, Resend } from "resend";

const PLACEHOLDER_MARKERS = ["placeholder", "your-", "re_your_"];

export interface EmailConfigStatus {
  configured: boolean;
  apiKey: string;
  from: string;
  fromDomain: string | null;
  isPlaceholderOrSandboxDomain: boolean;
}

function isRealValue(val: string | undefined): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

function extractDomainFromSender(from: string): string | null {
  const emailMatch = from.match(/<([^>]+)>/) ?? from.match(/([^\s<>]+@[^\s<>]+)/);
  const emailAddr = emailMatch?.[1]?.trim();
  if (!emailAddr || !emailAddr.includes("@")) return null;
  return emailAddr.split("@")[1]?.toLowerCase() ?? null;
}

export function getResendConfig(): EmailConfigStatus {
  const rawKey = process.env.RESEND_API_KEY;
  const rawFrom = process.env.EMAIL_FROM;

  const hasKey = isRealValue(rawKey);
  const hasFrom = isRealValue(rawFrom);
  const from = hasFrom ? rawFrom.trim() : "";
  const domain = from ? extractDomainFromSender(from) : null;
  const isPlaceholderOrSandboxDomain =
    !domain || domain === "resend.dev" || domain === "example.com" || domain.includes("your-");

  return {
    configured: hasKey && hasFrom && Boolean(domain),
    apiKey: hasKey ? rawKey.trim() : "",
    from,
    fromDomain: domain,
    isPlaceholderOrSandboxDomain,
  };
}

export function isResendConfigured(): boolean {
  return getResendConfig().configured;
}

export function getAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw || raw.includes("placeholder")) {
    return "http://localhost:3000";
  }
  return raw.replace(/\/+$/, "");
}

export async function renderReactEmail(element: React.ReactElement): Promise<{
  html: string;
  text: string;
}> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}

export interface SendEmailResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
  skippedUnconfigured?: boolean;
}

/**
 * Renders a React Email component to responsive HTML + plain text and delivers via Resend.
 */
export async function sendTransactionalEmail(input: {
  to: string | string[];
  subject: string;
  react: React.ReactElement;
  attachments?: Attachment[];
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}): Promise<SendEmailResult> {
  const cfg = getResendConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      messageId: null,
      error: "RESEND_API_KEY and verified EMAIL_FROM must be configured to deliver emails.",
      skippedUnconfigured: true,
    };
  }

  try {
    const { html, text } = await renderReactEmail(input.react);
    const resend = new Resend(cfg.apiKey);

    const { data, error } = await resend.emails.send({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      html,
      text,
      attachments: input.attachments,
      replyTo: input.replyTo,
      tags: input.tags,
    });

    if (error) {
      return {
        ok: false,
        messageId: null,
        error: error.message || "Resend API rejected the email send request.",
      };
    }

    return {
      ok: true,
      messageId: data?.id ?? null,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      messageId: null,
      error: err instanceof Error ? err.message : "Unexpected Resend delivery error.",
    };
  }
}
