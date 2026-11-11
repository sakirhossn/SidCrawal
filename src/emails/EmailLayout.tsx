import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

export interface EmailLayoutProps {
  previewText: string;
  badgeText?: string;
  appUrl: string;
  footerNote?: string;
  children: React.ReactNode;
}

export function EmailLayout({
  previewText,
  badgeText,
  appUrl,
  footerNote,
  children,
}: EmailLayoutProps) {
  const safeAppUrl = appUrl.replace(/\/+$/, "");

  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>{`
          @media only screen and (max-width: 600px) {
            .email-container {
              width: 100% !important;
              padding: 16px 12px !important;
            }
            .email-card {
              padding: 20px 16px !important;
            }
            .stack-col {
              display: block !important;
              width: 100% !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
              margin-bottom: 12px !important;
            }
          }
        `}</style>
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container className="email-container" style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <Link href={safeAppUrl} style={brandLinkStyle}>
              <span style={brandDotStyle} />
              <span>SidCrawal</span>
            </Link>
            {badgeText && <span style={badgeStyle}>{badgeText}</span>}
          </Section>

          {/* Card Content */}
          <Section className="email-card" style={cardStyle}>
            {children}
          </Section>

          {/* Footer */}
          <Hr style={hrStyle} />
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              {footerNote ??
                "Sent by SidCrawal automated website change monitoring."}
            </Text>
            <Text style={footerLinksStyle}>
              <Link href={`${safeAppUrl}/dashboard`} style={footerLinkStyle}>
                Dashboard
              </Link>
              {" · "}
              <Link href={`${safeAppUrl}/dashboard/history`} style={footerLinkStyle}>
                Change History
              </Link>
              {" · "}
              <Link href={`${safeAppUrl}/dashboard/settings`} style={footerLinkStyle}>
                Notification Settings
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  margin: 0,
  padding: 0,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  color: "#18181b",
};

const containerStyle: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "28px 16px 40px",
};

const headerStyle: React.CSSProperties = {
  marginBottom: "16px",
  padding: "0 4px",
};

const brandLinkStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "#09090b",
  textDecoration: "none",
  verticalAlign: "middle",
};

const brandDotStyle: React.CSSProperties = {
  display: "inline-block",
  width: "10px",
  height: "10px",
  borderRadius: "9999px",
  backgroundColor: "#059669",
  marginRight: "8px",
  verticalAlign: "middle",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  marginLeft: "10px",
  padding: "3px 9px",
  borderRadius: "9999px",
  backgroundColor: "#ecfdf5",
  border: "1px solid #a7f3d0",
  color: "#047857",
  fontSize: "11px",
  fontWeight: 600,
  verticalAlign: "middle",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  border: "1px solid #e4e4e7",
  padding: "28px 28px",
};

const hrStyle: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "22px 0 16px",
};

const footerStyle: React.CSSProperties = {
  padding: "0 4px",
};

const footerTextStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#71717a",
  margin: "0 0 6px",
};

const footerLinksStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#71717a",
  margin: 0,
};

const footerLinkStyle: React.CSSProperties = {
  color: "#3f3f46",
  textDecoration: "underline",
};
