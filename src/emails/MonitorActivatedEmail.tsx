import { Button, Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./EmailLayout";

export interface MonitorActivatedEmailProps {
  monitorId: string;
  monitorName: string;
  targetUrl: string;
  checkIntervalMinutes: number;
  selectionType: string;
  selectorLabel: string;
  appUrl: string;
}

export function MonitorActivatedEmailTemplate({
  monitorId,
  monitorName,
  targetUrl,
  checkIntervalMinutes,
  selectionType,
  selectorLabel,
  appUrl,
}: MonitorActivatedEmailProps) {
  const safeAppUrl = appUrl.replace(/\/+$/, "");
  const monitorLink = `${safeAppUrl}/dashboard/monitors/${encodeURIComponent(monitorId)}`;

  return (
    <EmailLayout
      previewText={`Monitoring activated for ${monitorName} (every ${checkIntervalMinutes} minutes).`}
      badgeText="Monitoring Active"
      appUrl={appUrl}
    >
      <Heading as="h1" style={headingStyle}>
        Monitor activated: {monitorName}
      </Heading>
      <Text style={paragraphStyle}>
        SidCrawal has scheduled automated Playwright checks for your selected target. After
        capturing your initial baseline snapshot, we will alert you whenever meaningful text
        or visual changes occur.
      </Text>

      <Section style={metaBoxStyle}>
        <Text style={metaRowStyle}>
          <strong>Website URL:</strong>{" "}
          <Link href={targetUrl} style={linkStyle}>
            {targetUrl}
          </Link>
        </Text>
        <Text style={metaRowStyle}>
          <strong>Check Frequency:</strong> Every {checkIntervalMinutes} minutes
        </Text>
        <Text style={metaRowStyle}>
          <strong>Selection Type:</strong> {selectionType}
        </Text>
        <Text style={{ ...metaRowStyle, marginBottom: 0 }}>
          <strong>Target Selector:</strong>{" "}
          <span style={monoStyle}>{selectorLabel}</span>
        </Text>
      </Section>

      <Section style={ctaWrapStyle}>
        <Button href={monitorLink} style={ctaButtonStyle}>
          Open Monitor in SidCrawal
        </Button>
      </Section>
    </EmailLayout>
  );
}

const headingStyle: React.CSSProperties = {
  fontSize: "20px",
  lineHeight: "28px",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "#09090b",
  margin: "0 0 12px",
};

const paragraphStyle: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#3f3f46",
  margin: "0 0 16px",
};

const metaBoxStyle: React.CSSProperties = {
  backgroundColor: "#fafafa",
  borderRadius: "8px",
  border: "1px solid #e4e4e7",
  padding: "14px 16px",
  marginBottom: "20px",
};

const metaRowStyle: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#27272a",
  margin: "0 0 6px",
  wordBreak: "break-word",
};

const monoStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: "12px",
};

const linkStyle: React.CSSProperties = {
  color: "#059669",
  textDecoration: "underline",
};

const ctaWrapStyle: React.CSSProperties = {
  margin: "12px 0 4px",
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
