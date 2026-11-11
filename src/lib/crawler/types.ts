import type { NormalizationRules } from "./normalization";
import type { BoundingBox, SelectionType, ViewportDimensions } from "../preview/types";

export type CrawlTriggerSource = "baseline" | "scheduled" | "manual";
export type CrawlRunStatus = "started" | "succeeded" | "failed" | "blocked" | "timeout";

export interface CrawlJobDispatchItem {
  job_id: string;
  monitor_id: string;
  user_id: string;
  url: string;
  monitor_name: string;
  check_interval_minutes: number;
  consecutive_failures: number;
  active_baseline_snapshot_id: string | null;
  trigger_source: CrawlTriggerSource;
  selection_id: string;
  selection_type: SelectionType;
  css_selector: string | null;
  selectors_json: string[];
  bounding_box: BoundingBox | null;
  viewport_dimensions: ViewportDimensions;
  normalization_rules: NormalizationRules;
}

export interface CrawlRunRecord {
  id: string;
  monitor_id: string;
  user_id: string;
  job_id: string | null;
  trigger_source: CrawlTriggerSource;
  status: CrawlRunStatus;
  http_status: number | null;
  resolved_ip: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SnapshotRecord {
  id: string;
  monitor_id: string;
  user_id: string;
  crawl_run_id: string;
  is_baseline: boolean;
  page_title: string | null;
  extracted_html: string | null;
  extracted_text: string | null;
  normalized_text: string | null;
  content_hash: string;
  element_screenshot_path: string | null;
  full_page_screenshot_path: string | null;
  visual_hash: string | null;
  captured_at: string;
}

export interface DetectedChangeRecord {
  id: string;
  monitor_id: string;
  user_id: string;
  previous_snapshot_id: string;
  current_snapshot_id: string;
  change_type: "text" | "visual" | "both";
  visual_diff_percentage: number | null;
  diff_screenshot_path: string | null;
  previous_text_excerpt: string | null;
  current_text_excerpt: string | null;
  diff_summary: Record<string, unknown>;
  change_fingerprint: string;
  detected_at: string;
}

export interface WorkerCrawlPayload {
  url: string;
  selectionType: SelectionType;
  cssSelector: string | null;
  selectors: string[];
  boundingBox: BoundingBox | null;
  viewport: ViewportDimensions;
  normalizationRules: NormalizationRules;
  timeoutMs?: number;
  previousBaseline?: {
    snapshotId: string;
    contentHash: string;
    normalizedText: string;
    visualHash: string | null;
    elementScreenshotBase64: string | null;
  } | null;
}

export interface WorkerCrawlSuccessResult {
  ok: true;
  finalUrl: string;
  pageTitle: string;
  httpStatus: number;
  resolvedIp: string | null;
  durationMs: number;
  extractedHtml: string;
  extractedText: string;
  normalizedText: string;
  contentHash: string;
  visualHash: string;
  fullPagePngBase64: string;
  elementPngBase64: string;
  diffPngBase64: string | null;
  visualDiffPercentage: number;
  mismatchedPixels: number;
  totalPixels: number;
  dimensionChanged: boolean;
  textChanged: boolean;
  visualChanged: boolean;
  hasMeaningfulChange: boolean;
  changeType: "text" | "visual" | "both" | null;
}

export interface WorkerCrawlFailureResult {
  ok: false;
  outcome: "failed" | "blocked" | "timeout";
  errorCode: string;
  errorMessage: string;
  httpStatus: number | null;
  resolvedIp: string | null;
  durationMs: number;
}

export type WorkerCrawlResponse = WorkerCrawlSuccessResult | WorkerCrawlFailureResult;
