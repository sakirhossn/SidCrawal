"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Crosshair, GitCompare, MailCheck, Maximize2 } from "lucide-react";
import { SAMPLE_PREVIEW_TARGETS } from "@/lib/landing-preview-data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PreviewMode = "selector" | "diff";

export function InteractivePreview() {
  const [activeId, setActiveId] = React.useState(SAMPLE_PREVIEW_TARGETS[0].id);
  const [mode, setMode] = React.useState<PreviewMode>("selector");
  const prefersReducedMotion = useReducedMotion();

  const activeTarget =
    SAMPLE_PREVIEW_TARGETS.find((item) => item.id === activeId) ??
    SAMPLE_PREVIEW_TARGETS[0];

  return (
    <div
      id="workspace-preview"
      className="rounded-xl border border-border bg-card text-card-foreground shadow-sm"
    >
      {/* Top browser-preview chrome */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="font-mono">isolated-chromium://preview</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px] font-normal">
            Sample Preview • Phase 1 UI
          </Badge>
        </div>
      </div>

      {/* Interactive control toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Sample target elements">
          {SAMPLE_PREVIEW_TARGETS.map((item) => {
            const isSelected = item.id === activeTarget.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveId(item.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "bg-background text-foreground shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setMode("selector")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "selector"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Crosshair className="size-3.5" aria-hidden="true" />
            Selector
          </button>
          <button
            type="button"
            onClick={() => setMode("diff")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "diff"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <GitCompare className="size-3.5" aria-hidden="true" />
            Diff Alert
          </button>
        </div>
      </div>

      {/* Main viewport canvas */}
      <div className="p-4 sm:p-5">
        {mode === "selector" ? (
          <div className="space-y-4">
            {/* Simulated rendered page wireframe */}
            <div className="relative rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">
                  viewport {activeTarget.viewport.width}×{activeTarget.viewport.height}
                </span>
                <span className="inline-flex items-center gap-1 font-mono">
                  <Maximize2 className="size-3" aria-hidden="true" />
                  {activeTarget.selectionType}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-dashed border-border/80 p-3 opacity-55">
                  <div className="h-2.5 w-16 rounded-xs bg-muted" />
                  <div className="mt-2 h-5 w-24 rounded-xs bg-muted" />
                </div>

                <motion.div
                  key={activeTarget.id}
                  initial={prefersReducedMotion ? false : { opacity: 0.75, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="relative rounded-md border border-emerald-600/80 bg-emerald-500/8 p-3 sm:col-span-2 dark:border-emerald-400/80 dark:bg-emerald-500/10"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      selected node
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      x:{activeTarget.boundingBox.x} y:{activeTarget.boundingBox.y}{" "}
                      {activeTarget.boundingBox.width}×{activeTarget.boundingBox.height}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {activeTarget.beforeText}
                  </p>
                </motion.div>
              </div>
            </div>

            {/* Metadata table */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[11px] font-medium text-muted-foreground">
                Saved CSS Selector
              </div>
              <code className="mt-1 block break-all font-mono text-xs text-foreground">
                {activeTarget.cssSelector}
              </code>
            </div>
          </div>
        ) : (
          <motion.div
            key={`${activeTarget.id}-diff`}
            initial={prefersReducedMotion ? false : { opacity: 0.8 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-background p-3.5">
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Baseline Snapshot</span>
                  <span className="font-mono">retained</span>
                </div>
                <p className="font-mono text-xs leading-relaxed text-muted-foreground line-through decoration-rose-500/70">
                  {activeTarget.beforeText}
                </p>
              </div>

              <div className="rounded-lg border border-emerald-600/50 bg-emerald-500/6 p-3.5 dark:border-emerald-400/50">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">
                    Current Capture
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    Δ {activeTarget.visualDiffPercent.toFixed(2)}%
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed text-foreground">
                  {activeTarget.afterText}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <MailCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Resend email trigger preview (deduplicated by change hash)
              </span>
              <span className="font-mono text-muted-foreground">
                {activeTarget.detectedAt}
              </span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
