import { createRequire } from "node:module";
import { Resend } from "resend";
import { ChangeAlertEmailTemplate } from "../src/emails/ChangeAlertEmail";
import { getAppBaseUrl, getResendConfig, sendTransactionalEmail } from "../src/lib/email/client";
import {
  sendPasswordResetEmailViaResend,
  sendVerificationEmailViaResend,
} from "../src/lib/email/notifications";
import { resolveChromiumExecutablePath } from "../worker/src/browser";
import { comparePngScreenshots } from "../worker/src/diff";

const require = createRequire(import.meta.url);

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateRealisticScreenshotTriplet(): Promise<{
  beforePng: Buffer;
  afterPng: Buffer;
  diffPng: Buffer;
}> {
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  const executablePath = resolveChromiumExecutablePath();
  const browser = await chromium.launch({ headless: true, executablePath });

  try {
    const page = await browser.newPage({
      viewport: { width: 640, height: 260 },
      deviceScaleFactor: 1,
    });

    const renderCard = (opts: { tier: string; badgeColor: string; price: string; bg: string }) => `
      <!doctype html>
      <html>
        <body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;">
          <div style="width:440px;padding:22px;border-radius:12px;border:2px solid #cbd5e1;background:${opts.bg};">
            <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${opts.badgeColor};color:#fff;font-size:12px;font-weight:bold;">${opts.tier}</span>
            <div style="font-size:32px;font-weight:bold;color:#0f172a;margin:14px 0;">${opts.price}</div>
            <div style="font-size:13px;color:#475569;">Checked automatically via SidCrawal Playwright worker</div>
          </div>
        </body>
      </html>
    `;

    await page.setContent(
      renderCard({
        tier: "Starter Tier",
        badgeColor: "#10b981",
        price: "$19 / month",
        bg: "#ffffff",
      })
    );
    const beforePng = await page.screenshot({
      type: "png",
      clip: { x: 16, y: 16, width: 492, height: 184 },
    });

    await page.setContent(
      renderCard({
        tier: "Pro Scale Tier (Updated)",
        badgeColor: "#f59e0b",
        price: "$49 / month",
        bg: "#fffbeb",
      })
    );
    const afterPng = await page.screenshot({
      type: "png",
      clip: { x: 16, y: 16, width: 492, height: 184 },
    });

    const comparison = comparePngScreenshots(beforePng, afterPng);
    return {
      beforePng,
      afterPng,
      diffPng: comparison.diffPngBuffer,
    };
  } finally {
    await browser.close();
  }
}

async function fetchDeliveryStatus(resend: Resend, id: string | null) {
  if (!id) return null;
  try {
    const res = await resend.emails.get(id);
    if (res.error) {
      return { id, logStatus: "unreadable_with_scoped_key", reason: res.error.message };
    }
    return {
      id: res.data?.id ?? id,
      last_event: res.data?.last_event ?? null,
      to: res.data?.to ?? null,
      from: res.data?.from ?? null,
      created_at: res.data?.created_at ?? null,
    };
  } catch (err) {
    return {
      id,
      logStatus: "lookup_error",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const recipient = (process.argv[2] ?? process.env.TEST_EMAIL_RECIPIENT ?? "").trim();
  const cfg = getResendConfig();

  if (!cfg.configured) {
    console.error(
      "RESEND_API_KEY and a verified EMAIL_FROM address are required in .env.local or environment variables."
    );
    process.exit(1);
  }

  if (cfg.isPlaceholderOrSandboxDomain) {
    console.error(
      `EMAIL_FROM (${cfg.from}) appears to use a placeholder or unverified domain (${cfg.fromDomain}). Use your Resend-verified sending domain.`
    );
    process.exit(1);
  }

  if (!recipient || !recipient.includes("@")) {
    console.error("Usage: npm run email:test-send -- <recipient@example.com>");
    process.exit(1);
  }

  const appUrl = getAppBaseUrl();
  const { beforePng, afterPng, diffPng } = await generateRealisticScreenshotTriplet();

  console.log(
    `Sending verification, password reset, and change alert test emails from ${cfg.from} -> ${recipient}...`
  );

  const verifyRes = await sendVerificationEmailViaResend({
    to: recipient,
    recipientName: "SidCrawal QA",
    verificationUrl: `${appUrl}/auth/callback?token_hash=live_verify_sample&type=signup&next=/dashboard`,
    appUrl,
  });

  await sleep(700);

  const resetRes = await sendPasswordResetEmailViaResend({
    to: recipient,
    recipientName: "SidCrawal QA",
    resetUrl: `${appUrl}/auth/callback?token_hash=live_reset_sample&type=recovery&next=/reset-password`,
    appUrl,
  });

  await sleep(700);

  const changeRes = await sendTransactionalEmail({
    to: recipient,
    subject: "[SidCrawal Live Test] Website change detected on Pricing Monitor",
    attachments: [
      {
        filename: "before-screenshot.png",
        content: beforePng,
        contentType: "image/png",
        contentId: "before-screenshot",
      },
      {
        filename: "after-screenshot.png",
        content: afterPng,
        contentType: "image/png",
        contentId: "after-screenshot",
      },
      {
        filename: "comparison-diff.png",
        content: diffPng,
        contentType: "image/png",
        contentId: "diff-screenshot",
      },
    ],
    react: ChangeAlertEmailTemplate({
      monitorId: "sample-monitor",
      monitorName: "Pricing Monitor",
      websiteTitle: "SidCrawal Controlled Pricing Fixture",
      websiteUrl: "https://example.com/pricing",
      detectedAt: new Date().toUTCString(),
      changeType: "both",
      visualDiffPercentage: 11.4,
      previousText: "Starter Tier — $19 / month",
      currentText: "Pro Scale Tier (Updated) — $49 / month",
      beforeScreenshotSrc: "cid:before-screenshot",
      afterScreenshotSrc: "cid:after-screenshot",
      diffScreenshotSrc: "cid:diff-screenshot",
      appUrl,
    }),
    tags: [{ name: "category", value: "live_test_change_alert" }],
  });

  await sleep(2500);
  const resend = new Resend(cfg.apiKey);
  const [verifyLog, resetLog, changeLog] = await Promise.all([
    fetchDeliveryStatus(resend, verifyRes.messageId),
    fetchDeliveryStatus(resend, resetRes.messageId),
    fetchDeliveryStatus(resend, changeRes.messageId),
  ]);

  console.log(
    JSON.stringify(
      {
        sender: cfg.from,
        verifiedDomain: cfg.fromDomain,
        recipient,
        attachmentSizesBytes: {
          beforePng: beforePng.length,
          afterPng: afterPng.length,
          diffPng: diffPng.length,
        },
        sends: { verifyRes, resetRes, changeRes },
        deliveryLogs: { verifyLog, resetLog, changeLog },
      },
      null,
      2
    )
  );

  if (!verifyRes.ok || !resetRes.ok || !changeRes.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
