import { Button, Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./EmailLayout";

export interface PasswordResetEmailProps {
  recipientName?: string | null;
  resetUrl: string;
  appUrl: string;
}

export function PasswordResetEmailTemplate({
  recipientName,
  resetUrl,
  appUrl,
}: PasswordResetEmailProps) {
  const greeting = recipientName?.trim() ? `Hi ${recipientName.trim()},` : "Hello,";

  return (
    <EmailLayout
      previewText="Reset your SidCrawal account password securely."
      badgeText="Password Reset"
      appUrl={appUrl}
      footerNote="Security notice: only you can complete this password reset using the link above."
    >
      <Heading as="h1" style={headingStyle}>
        Reset your SidCrawal password
      </Heading>
      <Text style={paragraphStyle}>{greeting}</Text>
      <Text style={paragraphStyle}>
        We received a request to reset the password for your SidCrawal monitoring account.
        Use the button below to choose a new password.
      </Text>

      <Section style={ctaWrapStyle}>
        <Button href={resetUrl} style={ctaButtonStyle}>
          Choose New Password
        </Button>
      </Section>

      <Text style={mutedLabelStyle}>
        If the button does not open, paste this link into your browser:
      </Text>
      <Text style={codeUrlStyle}>
        <Link href={resetUrl} style={linkStyle}>
          {resetUrl}
        </Link>
      </Text>

      <Text style={securityNoteStyle}>
        Did not request a password reset? Ignore this email — your existing password and
        active monitors remain untouched.
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
