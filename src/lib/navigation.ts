export type NavIconKey =
  | "layout-dashboard"
  | "plus-circle"
  | "crosshair"
  | "history"
  | "bell"
  | "settings"
  | "shield-check"
  | "activity";

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: NavIconKey;
  description: string;
  phase: string;
  group: "primary" | "history" | "system";
}

export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: "layout-dashboard",
    description: "Monitor inventory, integration status, and workspace readiness.",
    phase: "Phase 1 Shell",
    group: "primary",
  },
  {
    label: "Add Monitor",
    href: "/dashboard/monitors/new",
    icon: "plus-circle",
    description: "Validate a public URL and configure crawl intervals.",
    phase: "Phase 3",
    group: "primary",
  },
  {
    label: "Selection Workspace",
    href: "/dashboard/workspace",
    icon: "crosshair",
    description: "Interactive Chromium element & bounding-box selector studio.",
    phase: "Phase 3",
    group: "primary",
  },
  {
    label: "Monitor Details",
    href: "/dashboard/monitors/sample-monitor",
    icon: "activity",
    description: "Target configuration, baseline snapshot, and run diagnostics.",
    phase: "Phase 2–4",
    group: "primary",
  },
  {
    label: "Change History",
    href: "/dashboard/history",
    icon: "history",
    description: "Visual diffs and normalized text comparisons across runs.",
    phase: "Phase 4",
    group: "history",
  },
  {
    label: "Notifications",
    href: "/dashboard/notifications",
    icon: "bell",
    description: "Resend email delivery ledger and duplicate suppression audit.",
    phase: "Phase 5",
    group: "history",
  },
  {
    label: "User Settings",
    href: "/dashboard/settings",
    icon: "settings",
    description: "Default cadence, alert preferences, timezone, and quota view.",
    phase: "Phase 2",
    group: "system",
  },
  {
    label: "Admin",
    href: "/dashboard/admin",
    icon: "shield-check",
    description: "Global worker health, SSRF blocks, and concurrency limits.",
    phase: "Phase 6",
    group: "system",
  },
];
