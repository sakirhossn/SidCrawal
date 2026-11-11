import * as React from "react";
import { cn } from "@/lib/utils";

interface SidCrawalLogoProps {
  className?: string;
  showWordmark?: boolean;
  compact?: boolean;
}

export function SidCrawalLogo({
  className,
  showWordmark = true,
  compact = false,
}: SidCrawalLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span
        className={cn(
          "relative flex items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-xs",
          compact ? "size-7" : "size-8"
        )}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={cn(compact ? "size-4" : "size-[18px]")}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Outer selector corner brackets */}
          <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
          <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
          <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
          <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
          {/* Precision target node */}
          <rect
            x="8.25"
            y="8.25"
            width="7.5"
            height="7.5"
            rx="1.5"
            className="stroke-emerald-600 dark:stroke-emerald-400"
          />
          <circle
            cx="12"
            cy="12"
            r="1.4"
            className="fill-emerald-600 stroke-none dark:fill-emerald-400"
          />
        </svg>
      </span>
      {showWordmark ? (
        <span className="font-sans text-[15px] font-semibold tracking-tight text-foreground">
          SidCrawal
        </span>
      ) : null}
    </span>
  );
}
