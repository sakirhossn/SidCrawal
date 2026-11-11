import { Button, Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./EmailLayout";

export interface VerifyEmailProps {
  recipientName?: string | null;
  verificationUrl: string;
  appUrl: string;
}

export function VerifyEmailTemplate({
  recipientName,
  verificationUrl,
  appUrl,
}: VerifyEmailProps) {
  const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : "Hello,";

  return (
    <EmailLayout
      previewText="Verify your email address to activate website monitoring in SidCrawal."
      badgeText="Verify Email"
      appUrl={appUrl}
      footerNote="You received this email because an account was registered using this email address on SidCrawal."
    >
      <Heading as="h1" style={headingStyle}>
        Confirm your email address
      </Heading>
      <Text style={paragraphStyle}>{greeting}</Text>
      <Text style={paragraphStyle}>
        Welcome to <strong>SidCrawal</strong>. Confirm ownership of this email address to
        unlock your dashboard, render webpages in isolated Chromium, and receive automated
        change detection alerts.
      </Text>

      <Section style={ctaWrapStyle}>
        <Button href={verificationUrl} style={ctaButtonStyle}>
          Verify Email Address
        </Button>
      </Section>

      <Text style={mutedLabelStyle}>
        Or copy and paste this verification URL into your browser:
      </Text>
      <Text style={codeUrlStyle}>
        <Link href={verificationUrl} style={linkStyle}>
          {verificationUrl}
        </Link>
      </Text>

      <Text style={securityNoteStyle}>
        If you did not sign up for SidCrawal, you can safely ignore this message — no
        monitors will be created without verification.
      </Text>
    </EmailLayout>
  );
}

const headingStyle: React.CSSProperties = {
  fontSize: "20px",
  lineHeight: "28px",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "#09090b",
  margin: "0 0 14px",
};

const paragraphStyle: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#3f3f46",
  margin: "0 0 12px",
};

const ctaWrapStyle: React.CSSProperties = {
  margin: "22px 0",
};

const ctaButtonStyle: React.CSSProperties = {
  backgroundColor: "#09090b",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  padding: "12px 22px",
  borderRadius: "8px",
  textDecoration: "none",
  display: "inline-block",
};

const mutedLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#71717a",
  margin: "0 0 4px",
};

const codeUrlStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  backgroundColor: "#f4f4f5",
  borderRadius: "6px",
  border: "1px solid #e4e4e7",
  padding: "10px 12px",
  wordBreak: "break-all",
  margin: "0 0 16px",
};

const linkStyle: React.CSSProperties = {
  color: "#059669",
  textDecoration: "underline",
};

const securityNoteStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#71717a",
  margin: 0,
};
