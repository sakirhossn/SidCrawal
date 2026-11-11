import { Button, Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./EmailLayout";

export interface WeeklyDigestItem {
  monitorId: string;
  monitorName: string;
  url: string;
  changesCount: number;
  lastCheckedAt: string | null;
}

export interface WeeklyDigestEmailProps {
  recipientName?: string | null;
  periodLabel: string;
  totalActiveMonitors: number;
  totalChangesDetected: number;
  items: WeeklyDigestItem[];
  appUrl: string;
}

export function WeeklyDigestEmailTemplate({
  recipientName,
  periodLabel,
  totalActiveMonitors,
  totalChangesDetected,
  items,
  appUrl,
}: WeeklyDigestEmailProps) {
  const safeAppUrl = appUrl.replace(/\/+$/, "");

  return (
    <EmailLayout
      previewText={`SidCrawal weekly summary: ${totalChangesDetected} changes detected across ${totalActiveMonitors} monitors.`}
      badgeText="Weekly Digest"
      appUrl={appUrl}
    >
      <Heading as="h1" style={headingStyle}>
        Weekly Monitoring Summary ({periodLabel})
      </Heading>
      <Text style={paragraphStyle}>
        {recipientName ? `Hi ${recipientName}, ` : "Hello, "}here is your weekly activity
        report across {totalActiveMonitors} active monitor
        {totalActiveMonitors === 1 ? "" : "s"} ({totalChangesDetected} meaningful change
        {totalChangesDetected === 1 ? "" : "s"} detected).
      </Text>

      <Section style={listBoxStyle}>
        {items.length === 0 ? (
          <Text style={rowTextStyle}>No active monitor activity recorded this week.</Text>
        ) : (
          items.map((item) => (
            <Section key={item.monitorId} style={itemRowStyle}>
              <Text style={rowTitleStyle}>
                <Link
                  href={`${safeAppUrl}/dashboard/monitors/${encodeURIComponent(
                    item.monitorId
                  )}`}
                  style={linkStyle}
                >
                  {item.monitorName}
                </Link>
              </Text>
              <Text style={rowTextStyle}>
                {item.url} • {item.changesCount} change
                {item.changesCount === 1 ? "" : "s"}
              </Text>
            </Section>
          ))
        )}
      </Section>

      <Section style={ctaWrapStyle}>
        <Button href={`${safeAppUrl}/dashboard/history`} style={ctaButtonStyle}>
          Open Full Change History
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

const listBoxStyle: React.CSSProperties = {
  borderRadius: "8px",
  border: "1px solid #e4e4e7",
  backgroundColor: "#fafafa",
  padding: "12px 14px",
  marginBottom: "18px",
};

const itemRowStyle: React.CSSProperties = {
  marginBottom: "10px",
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  margin: "0 0 2px",
};

const rowTextStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#52525b",
  margin: 0,
  wordBreak: "break-word",
};

const linkStyle: React.CSSProperties = {
  color: "#059669",
  textDecoration: "underline",
};

const ctaWrapStyle: React.CSSProperties = {
  margin: "8px 0 4px",
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
