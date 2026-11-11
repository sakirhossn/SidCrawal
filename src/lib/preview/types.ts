import type { NormalizationRules } from "../crawler/normalization";

export type SelectionType = "element" | "multi_element" | "region";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportDimensions {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface PreviewElement {
  id: string;
  selector: string;
  tag: string;
  text: string;
  boundingBox: BoundingBox;
  metadata: {
    idAttr: string | null;
    classes: string[];
    role: string | null;
    ariaLabel: string | null;
    href: string | null;
    domDepth: number;
  };
}

export interface PreviewRenderResponse {
  previewId: string;
  finalUrl: string;
  pageTitle: string;
  httpStatus: number;
  resolvedIp: string | null;
  frameBlockedByHeader: boolean;
  framePolicyHeader: string | null;
  viewport: ViewportDimensions;
  documentDimensions: {
    width: number;
    height: number;
  };
  screenshotDataUrl: string;
  elements: PreviewElement[];
}

export interface MonitorSelectionRecord {
  id: string;
  monitor_id: string;
  selection_type: SelectionType;
  css_selector: string | null;
  selectors_json: string[];
  element_metadata: Record<string, unknown>;
  bounding_box: BoundingBox | null;
  viewport_dimensions: ViewportDimensions;
  selected_text: string | null;
  normalization_rules: NormalizationRules;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MonitorRecord {
  id: string;
  name: string;
  url: string;
  normalized_host: string;
  status: "draft" | "active" | "paused" | "error" | "blocked";
  check_interval_minutes: number;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}
