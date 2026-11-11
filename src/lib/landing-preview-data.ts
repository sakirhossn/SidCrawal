export interface PreviewSelectorTarget {
  id: string;
  label: string;
  selectionType: "element" | "multi_element" | "region";
  cssSelector: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  beforeText: string;
  afterText: string;
  visualDiffPercent: number;
  detectedAt: string;
}

/**
 * Static sample data strictly for demonstrating the SidCrawal selection and
 * diff workflow on the Phase 1 Landing Page and Workspace Shell.
 * No live external websites are crawled in Phase 1.
 */
export const SAMPLE_PREVIEW_TARGETS: PreviewSelectorTarget[] = [
  {
    id: "pricing-pro-tier",
    label: "Pro Plan Price Cell",
    selectionType: "element",
    cssSelector: "section#pricing > div.grid > article[data-tier='pro'] .price-amount",
    boundingBox: { x: 412, y: 184, width: 210, height: 56 },
    viewport: { width: 1280, height: 800 },
    beforeText: "$29 / month (annual billing)",
    afterText: "$39 / month (annual billing)",
    visualDiffPercent: 4.82,
    detectedAt: "Sample Output (Phase 4 Target)",
  },
  {
    id: "status-incident-banner",
    label: "Service Status Banner",
    selectionType: "region",
    cssSelector: "main > div.status-summary[role='region']",
    boundingBox: { x: 96, y: 76, width: 1088, height: 88 },
    viewport: { width: 1280, height: 800 },
    beforeText: "All Systems Operational — EU-West Latency 24ms",
    afterText: "Degraded Performance — EU-West API Gateway (Investigating)",
    visualDiffPercent: 18.4,
    detectedAt: "Sample Output (Phase 4 Target)",
  },
  {
    id: "changelog-release-tag",
    label: "Release Tag & Policy Date",
    selectionType: "multi_element",
    cssSelector: "article.release-latest h2, article.release-latest time",
    boundingBox: { x: 140, y: 268, width: 640, height: 72 },
    viewport: { width: 1280, height: 800 },
    beforeText: "v2.4.0 — Updated Oct 14, 2026",
    afterText: "v2.5.0 — Updated Nov 09, 2026 (Breaking Webhook Header)",
    visualDiffPercent: 9.15,
    detectedAt: "Sample Output (Phase 4 Target)",
  },
];
