import {
  Button,
  Column,
  Heading,
  Img,
  Link,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./EmailLayout";

export interface ChangeAlertEmailProps {
  monitorId: string;
  monitorName: string;
  websiteTitle: string;
  websiteUrl: string;
  detectedAt: string;
  changeType: "text" | "visual" | "both";
  visualDiffPercentage: number | null;
  previousText: string;
  currentText: string;
  beforeScreenshotSrc?: string | null;
  afterScreenshotSrc?: string | null;
  diffScreenshotSrc?: string | null;
  appUrl: string;
}

export function ChangeAlertEmailTemplate({
  monitorId,
  monitorName,
  websiteTitle,
  websiteUrl,
  detectedAt,
  changeType,
  visualDiffPercentage,
  previousText,
  currentText,
  beforeScreenshotSrc,
  afterScreenshotSrc,
  diffScreenshotSrc,
  appUrl,
}: ChangeAlertEmailProps) {
  const safeAppUrl = appUrl.replace(/\/+$/, "");
  const monitorUrl = `${safeAppUrl}/dashboard/monitors/${encodeURIComponent(monitorId)}`;
  const historyUrl = `${safeAppUrl}/dashboard/history`;

  return (
    <EmailLayout
      previewText={`Change detected on ${monitorName}: ${currentText.slice(0, 90)}`}
      badgeText="Change Detected"
      appUrl={appUrl}
    >
      <Heading as="h1" style={headingStyle}>
        Website change detected: {monitorName}
      </Heading>

      <Section style={metaBoxStyle}>
        <Text style={metaRowStyle}>
          <strong>Page Title:</strong> {websiteTitle || monitorName}
        </Text>
        <Text style={metaRowStyle}>
          <strong>Website URL:</strong>{" "}
          <Link href={websiteUrl} style={linkStyle}>
            {websiteUrl}
          </Link>
        </Text>
        <Text style={metaRowStyle}>
          <strong>Detected At:</strong> {detectedAt}
        </Text>
        <Text style={{ ...metaRowStyle, marginBottom: 0 }}>
          <strong>Change Summary:</strong> {changeType}
          {visualDiffPercentage !== null
            ? ` • ${visualDiffPercentage.toFixed(2)}% visual difference`
            : ""}
        </Text>
      </Section>

      {/* Changed Text Comparison */}
      <Text style={sectionLabelStyle}>Changed Text</Text>
      <Row style={{ marginBottom: "18px" }}>
        <Column
          className="stack-col"
          style={{ width: "50%", paddingRight: "6px", verticalAlign: "top" }}
        >
          <Section style={prevTextCardStyle}>
            <Text style={cardCaptionMutedStyle}>BEFORE</Text>
            <Text style={excerptTextStyle}>{previousText || "(empty)"}</Text>
          </Section>
        </Column>
        <Column
          className="stack-col"
          style={{ width: "50%", paddingLeft: "6px", verticalAlign: "top" }}
        >
          <Section style={currTextCardStyle}>
            <Text style={cardCaptionGreenStyle}>AFTER</Text>
            <Text style={excerptTextStyle}>{currentText || "(empty)"}</Text>
          </Section>
        </Column>
      </Row>

      {/* Before and After Screenshots */}
      {(beforeScreenshotSrc || afterScreenshotSrc) && (
        <>
          <Text style={sectionLabelStyle}>Before &amp; After Screenshots</Text>
          <Row style={{ marginBottom: "18px" }}>
            {beforeScreenshotSrc && (
              <Column
                className="stack-col"
                style={{
                  width: afterScreenshotSrc ? "50%" : "100%",
                  paddingRight: afterScreenshotSrc ? "6px" : "0",
                  verticalAlign: "top",
                }}
              >
                <Section style={shotFrameStyle}>
                  <Text style={cardCaptionMutedStyle}>PREVIOUS BASELINE</Text>
                  <Img
                    src={beforeScreenshotSrc}
                    alt={`Previous baseline screenshot for ${monitorName}`}
                    width="250"
                    style={shotImgStyle}
                  />
                </Section>
              </Column>
            )}
            {afterScreenshotSrc && (
              <Column
                className="stack-col"
                style={{
                  width: beforeScreenshotSrc ? "50%" : "100%",
                  paddingLeft: beforeScreenshotSrc ? "6px" : "0",
                  verticalAlign: "top",
                }}
              >
                <Section style={shotFrameStyle}>
                  <Text style={cardCaptionGreenStyle}>CURRENT CAPTURE</Text>
                  <Img
                    src={afterScreenshotSrc}
                    alt={`Current screenshot for ${monitorName}`}
                    width="250"
                    style={shotImgStyle}
                  />
                </Section>
              </Column>
            )}
          </Row>
        </>
      )}

      {/* Visual Comparison Overlay Image */}
      {diffScreenshotSrc && (
        <>
          <Text style={sectionLabelStyle}>Visual Comparison Image</Text>
          <Section style={{ ...shotFrameStyle, marginBottom: "22px" }}>
            <Text style={cardCaptionMutedStyle}>
              PIXEL DIFFERENCE MASK
              {visualDiffPercentage !== null
                ? ` (${visualDiffPercentage.toFixed(2)}% CHANGED)`
                : ""}
            </Text>
            <Img
              src={diffScreenshotSrc}
              alt={`Visual comparison diff mask for ${monitorName}`}
              width="520"
              style={shotImgStyle}
            />
          </Section>
        </>
      )}

      {/* Primary Action Links to SidCrawal */}
      <Section style={ctaWrapStyle}>
        <Button href={monitorUrl} style={ctaButtonStyle}>
          Inspect Change in SidCrawal
        </Button>
      </Section>
      <Text style={secondaryLinkStyle}>
        View all detected events in{" "}
        <Link href={historyUrl} style={linkStyle}>
          Change History
        </Link>
        .
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

const metaBoxStyle: React.CSSProperties = {
  backgroundColor: "#fafafa",
  borderRadius: "8px",
  border: "1px solid #e4e4e7",
  padding: "14px 16px",
  marginBottom: "18px",
};

const metaRowStyle: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#27272a",
  margin: "0 0 6px",
  wordBreak: "break-word",
};

const linkStyle: React.CSSProperties = {
  color: "#059669",
  textDecoration: "underline",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "16px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#52525b",
  margin: "0 0 8px",
};

const prevTextCardStyle: React.CSSProperties = {
  backgroundColor: "#fafafa",
  border: "1px solid #e4e4e7",
  borderRadius: "8px",
  padding: "12px",
};

const currTextCardStyle: React.CSSProperties = {
  backgroundColor: "#ecfdf5",
  border: "1px solid #a7f3d0",
  borderRadius: "8px",
  padding: "12px",
};

const cardCaptionMutedStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "#71717a",
  margin: "0 0 6px",
};

const cardCaptionGreenStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "#047857",
  margin: "0 0 6px",
};

const excerptTextStyle: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "19px",
  color: "#18181b",
  margin: 0,
  wordBreak: "break-word",
};

const shotFrameStyle: React.CSSProperties = {
  backgroundColor: "#fafafa",
  border: "1px solid #e4e4e7",
  borderRadius: "8px",
  padding: "10px",
};

const shotImgStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  height: "auto",
  borderRadius: "6px",
  border: "1px solid #e4e4e7",
  backgroundColor: "#ffffff",
};

const ctaWrapStyle: React.CSSProperties = {
  margin: "6px 0 12px",
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

const secondaryLinkStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#71717a",
  margin: 0,
};
