"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  BoxSelect,
  CheckCircle2,
  Clock,
  Crosshair,
  ExternalLink,
  Layers,
  Loader2,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  clientPointToDocumentCoords,
  computeUnionBoundingBox,
  filterRegionPreviewElements,
  findDeepestElementAtPoint,
  normalizeTextSnippet,
} from "@/lib/preview/selection-math";
import type {
  BoundingBox,
  MonitorRecord,
  MonitorSelectionRecord,
  PreviewElement,
  PreviewRenderResponse,
  SelectionType,
} from "@/lib/preview/types";
import { validateTargetUrl } from "@/lib/url-validation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ViewportPreset = "desktop" | "mobile";

interface RenderErrorState {
  code: string;
  message: string;
}

interface WorkspaceStudioProps {
  supabaseConfigured: boolean;
}

const INTERVAL_OPTIONS = [
  { label: "Every 15 minutes", value: "15" },
  { label: "Every 30 minutes", value: "30" },
  { label: "Every 1 hour", value: "60" },
  { label: "Every 6 hours", value: "360" },
  { label: "Every 24 hours", value: "1440" },
];

export function WorkspaceStudio({ supabaseConfigured }: WorkspaceStudioProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramMonitorId = searchParams.get("monitorId");
  const paramUrl = searchParams.get("url") ?? "";
  const paramName = searchParams.get("name") ?? "";
  const paramInterval = searchParams.get("interval") ?? "60";

  const [monitorId, setMonitorId] = React.useState<string | null>(paramMonitorId);
  const [monitorName, setMonitorName] = React.useState(paramName);
  const [checkInterval, setCheckInterval] = React.useState(paramInterval);
  const [urlInput, setUrlInput] = React.useState(paramUrl || "https://example.com");
  const [viewport, setViewport] = React.useState<ViewportPreset>("desktop");

  const [loadingRender, setLoadingRender] = React.useState(false);
  const [renderError, setRenderError] = React.useState<RenderErrorState | null>(null);
  const [preview, setPreview] = React.useState<PreviewRenderResponse | null>(null);

  const [tool, setTool] = React.useState<SelectionType>("element");
  const [hoveredElement, setHoveredElement] = React.useState<PreviewElement | null>(null);
  const [selectedElements, setSelectedElements] = React.useState<PreviewElement[]>([]);
  const [customSelector, setCustomSelector] = React.useState("");
  const [regionBox, setRegionBox] = React.useState<BoundingBox | null>(null);
  const [dragOrigin, setDragOrigin] = React.useState<{ x: number; y: number } | null>(null);
  const [elementFilter, setElementFilter] = React.useState("");

  const [collapseWhitespace, setCollapseWhitespace] = React.useState(true);
  const [ignoreNumbers, setIgnoreNumbers] = React.useState(false);
  const [stripTimestamps, setStripTimestamps] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState<{
    message: string;
    monitorId: string;
    status: string;
  } | null>(null);

  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const viewportDimensions =
    viewport === "desktop"
      ? { width: 1280, height: 800, deviceScaleFactor: 1 }
      : { width: 390, height: 844, deviceScaleFactor: 1 };

  // Load existing monitor & selection when editing an existing monitorId
  React.useEffect(() => {
    if (!paramMonitorId || !supabaseConfigured) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/monitors/${encodeURIComponent(paramMonitorId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          monitor?: MonitorRecord;
          selection?: MonitorSelectionRecord | null;
        };
        if (cancelled || !data.monitor) return;

        setMonitorId(data.monitor.id);
        setMonitorName(data.monitor.name);
        setUrlInput(data.monitor.url);
        setCheckInterval(String(data.monitor.check_interval_minutes));

        if (data.selection) {
          setTool(data.selection.selection_type);
          setCustomSelector(data.selection.css_selector ?? "");
          if (data.selection.bounding_box && data.selection.selection_type === "region") {
            setRegionBox(data.selection.bounding_box);
          }
          if (data.selection.viewport_dimensions?.width === 390) {
            setViewport("mobile");
          }
          setCollapseWhitespace(
            data.selection.normalization_rules?.collapseWhitespace ?? true
          );
          setIgnoreNumbers(data.selection.normalization_rules?.ignoreNumbers ?? false);
          setStripTimestamps(
            data.selection.normalization_rules?.stripTimestamps ?? false
          );
        }
      } catch {
        // Non-fatal load error; user can still re-enter URL
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paramMonitorId, supabaseConfigured]);

  async function handleRenderWebsite(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setRenderError(null);
    setSaveError(null);
    setSaveSuccess(null);

    const syntax = validateTargetUrl(urlInput);
    if (!syntax.valid || !syntax.normalizedUrl) {
      setRenderError({
        code: "INVALID_URL",
        message: syntax.reason ?? "Enter a valid public website URL.",
      });
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoadingRender(true);
    setHoveredElement(null);

    try {
      const response = await fetch("/api/preview/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: syntax.normalizedUrl,
          viewport: {
            width: viewportDimensions.width,
            height: viewportDimensions.height,
          },
        }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as
        | PreviewRenderResponse
        | { error?: { code?: string; message?: string } };

      if (!response.ok || !("screenshotDataUrl" in payload)) {
        const err = "error" in payload ? payload.error : undefined;
        setRenderError({
          code: err?.code ?? "PREVIEW_FAILED",
          message:
            err?.message ??
            "Could not render the website inside the isolated browser worker.",
        });
        return;
      }

      setPreview(payload);
      setUrlInput(payload.finalUrl);
      if (!monitorName.trim()) {
        setMonitorName(payload.pageTitle.slice(0, 120) || syntax.host || "Monitor");
      }
      setSelectedElements([]);
      setCustomSelector("");
      setRegionBox(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setRenderError({
          code: "ABORTED",
          message: "Website rendering cancelled.",
        });
      } else {
        setRenderError({
          code: "NETWORK_ERROR",
          message: "Network failure while contacting the preview endpoint.",
        });
      }
    } finally {
      setLoadingRender(false);
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!preview || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pt = clientPointToDocumentCoords(
      event.clientX,
      event.clientY,
      rect,
      preview.documentDimensions
    );

    if (tool === "region" && dragOrigin) {
      const x = Math.min(dragOrigin.x, pt.x);
      const y = Math.min(dragOrigin.y, pt.y);
      const width = Math.max(8, Math.abs(pt.x - dragOrigin.x));
      const height = Math.max(8, Math.abs(pt.y - dragOrigin.y));
      setRegionBox({ x, y, width, height });
      return;
    }

    if (tool !== "region") {
      const hit = findDeepestElementAtPoint(preview.elements, pt.x, pt.y);
      setHoveredElement(hit);
    }
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!preview || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pt = clientPointToDocumentCoords(
      event.clientX,
      event.clientY,
      rect,
      preview.documentDimensions
    );

    if (tool === "region") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragOrigin(pt);
      setRegionBox({ x: pt.x, y: pt.y, width: 10, height: 10 });
      setSelectedElements([]);
      setCustomSelector("");
      return;
    }

    const hit = findDeepestElementAtPoint(preview.elements, pt.x, pt.y);
    if (!hit) return;

    if (tool === "element") {
      setSelectedElements([hit]);
      setCustomSelector(hit.selector);
      setRegionBox(hit.boundingBox);
    } else {
      setSelectedElements((prev) => {
        const exists = prev.some((item) => item.id === hit.id);
        const next = exists
          ? prev.filter((item) => item.id !== hit.id)
          : [...prev, hit];
        setCustomSelector(next.map((item) => item.selector).join(", "));
        setRegionBox(computeUnionBoundingBox(next));
        return next;
      });
    }
  }

  function clearActiveDrag(event?: React.PointerEvent<HTMLDivElement>) {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragOrigin(null);
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== "region" || !dragOrigin) return;
    clearActiveDrag(event);
    if (preview && regionBox) {
      const inside = filterRegionPreviewElements(preview.elements, regionBox);
      setSelectedElements(inside);
    }
  }

  function handleSelectFromList(el: PreviewElement) {
    if (tool === "region") {
      setTool("element");
    }
    if (tool === "multi_element") {
      setSelectedElements((prev) => {
        const exists = prev.some((item) => item.id === el.id);
        const next = exists ? prev.filter((item) => item.id !== el.id) : [...prev, el];
        setCustomSelector(next.map((item) => item.selector).join(", "));
        setRegionBox(computeUnionBoundingBox(next));
        return next;
      });
    } else {
      setSelectedElements([el]);
      setCustomSelector(el.selector);
      setRegionBox(el.boundingBox);
    }
  }

  const activeBoundingBox =
    tool === "region"
      ? regionBox
      : computeUnionBoundingBox(selectedElements) ?? regionBox;

  const rawSelectedText =
    selectedElements.length > 0
      ? selectedElements.map((el) => el.text).filter(Boolean).join("\n")
      : "";

  const normalizedPreviewText = normalizeTextSnippet(rawSelectedText, {
    collapseWhitespace,
    ignoreNumbers,
    stripTimestamps,
  });

  const activeSelectors =
    tool === "region"
      ? []
      : selectedElements.length > 0
        ? selectedElements.map((el) => el.selector)
        : customSelector.trim()
          ? [customSelector.trim()]
          : [];

  const selectionPayload = {
    url: preview?.finalUrl ?? urlInput.trim(),
    selectionType: tool,
    cssSelector:
      tool === "region"
        ? null
        : customSelector.trim() || activeSelectors[0] || null,
    selectors: activeSelectors,
    elementMetadata: {
      pageTitle: preview?.pageTitle ?? monitorName,
      frameBlockedByHeader: preview?.frameBlockedByHeader ?? false,
      elements: selectedElements.map((el) => ({
        tag: el.tag,
        ...el.metadata,
      })),
    },
    boundingBox: activeBoundingBox,
    viewportDimensions: preview?.viewport ?? viewportDimensions,
    selectedText: normalizedPreviewText,
    normalizationRules: {
      collapseWhitespace,
      ignoreNumbers,
      stripTimestamps,
    },
  };

  async function handleSaveMonitor(activate: boolean) {
    setSaveError(null);
    setSaveSuccess(null);

    if (tool === "region" && !activeBoundingBox) {
      setSaveError("Draw a rectangle over the rendered preview before saving.");
      return;
    }
    if (tool !== "region" && !selectionPayload.cssSelector) {
      setSaveError("Select an HTML element on the page or enter a CSS selector.");
      return;
    }

    if (!supabaseConfigured) {
      setSaveError(
        "Supabase credentials are not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to save monitors to PostgreSQL."
      );
      return;
    }

    setSaving(true);
    try {
      let targetMonitorId = monitorId;

      if (!targetMonitorId) {
        const createRes = await fetch("/api/monitors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: monitorName.trim() || preview?.pageTitle || "Website Monitor",
            url: selectionPayload.url,
            checkIntervalMinutes: Number(checkInterval),
          }),
        });
        const createData = (await createRes.json().catch(() => ({}))) as {
          monitor?: MonitorRecord;
          error?: { message?: string };
        };
        if (!createRes.ok || !createData.monitor) {
          setSaveError(createData.error?.message ?? "Failed to create monitor.");
          return;
        }
        targetMonitorId = createData.monitor.id;
        setMonitorId(targetMonitorId);
      } else {
        await fetch(`/api/monitors/${encodeURIComponent(targetMonitorId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: monitorName.trim() || preview?.pageTitle || "Website Monitor",
            checkIntervalMinutes: Number(checkInterval),
          }),
        });
      }

      const selRes = await fetch(
        `/api/monitors/${encodeURIComponent(targetMonitorId)}/selection`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectionType: selectionPayload.selectionType,
            cssSelector: selectionPayload.cssSelector,
            selectors: selectionPayload.selectors,
            elementMetadata: selectionPayload.elementMetadata,
            boundingBox: selectionPayload.boundingBox,
            viewportDimensions: selectionPayload.viewportDimensions,
            selectedText: selectionPayload.selectedText,
            normalizationRules: selectionPayload.normalizationRules,
            activate,
          }),
        }
      );

      const selData = (await selRes.json().catch(() => ({}))) as {
        ok?: boolean;
        monitorStatus?: string;
        error?: { message?: string };
      };

      if (!selRes.ok) {
        setSaveError(selData.error?.message ?? "Failed to save selection.");
        return;
      }

      setSaveSuccess({
        monitorId: targetMonitorId,
        status: selData.monitorStatus ?? (activate ? "active" : "draft"),
        message: activate
          ? "Selection saved and monitor activated for scheduled crawls."
          : "Selection saved as draft.",
      });
      router.refresh();
    } catch {
      setSaveError("Network error while saving monitor selection.");
    } finally {
      setSaving(false);
    }
  }

  const filteredElements = React.useMemo(() => {
    if (!preview) return [];
    const q = elementFilter.trim().toLowerCase();
    if (!q) return preview.elements.slice(0, 60);
    return preview.elements
      .filter(
        (el) =>
          el.tag.includes(q) ||
          el.selector.toLowerCase().includes(q) ||
          el.text.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [preview, elementFilter]);

  return (
    <div className="space-y-4">
      {/* URL & Viewport Bar */}
      <form
        onSubmit={handleRenderWebsite}
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center"
        noValidate
      >
        <div className="flex-1">
          <Label htmlFor="workspace-url-input" className="sr-only">
            Target website URL
          </Label>
          <Input
            id="workspace-url-input"
            type="url"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (renderError) setRenderError(null);
            }}
            className="font-mono text-sm"
            placeholder="https://github.com/pricing"
            disabled={loadingRender}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setViewport("desktop")}
              aria-label="Desktop viewport 1280 by 800"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                viewport === "desktop"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Monitor className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">1280×800</span>
            </button>
            <button
              type="button"
              onClick={() => setViewport("mobile")}
              aria-label="Mobile viewport 390 by 844"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                viewport === "mobile"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Smartphone className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">390×844</span>
            </button>
          </div>

          {loadingRender ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => abortControllerRef.current?.abort()}
            >
              Cancel Render
            </Button>
          ) : (
            <Button type="submit" size="sm">
              Load Website Preview
            </Button>
          )}
        </div>
      </form>

      {/* Error / Blocked / Timeout Diagnostic Banner */}
      {renderError && (
        <div
          role="alert"
          className={cn(
            "flex items-start justify-between gap-3 rounded-xl border p-4 text-xs leading-relaxed",
            renderError.code === "BLOCKED_BY_CHALLENGE"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}
        >
          <div className="flex items-start gap-2.5">
            {renderError.code === "WORKER_TIMEOUT" ? (
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <div className="space-y-1">
              <div className="font-semibold">
                {renderError.code === "BLOCKED_BY_CHALLENGE" &&
                  "Website Blocked Access (Anti-Bot / CAPTCHA)"}
                {renderError.code === "WORKER_TIMEOUT" && "Page Render Timed Out"}
                {renderError.code === "SSRF_BLOCKED_TARGET" &&
                  "Security Policy Blocked Target URL"}
                {renderError.code === "INVALID_URL" && "Invalid Website URL"}
                {![
                  "BLOCKED_BY_CHALLENGE",
                  "WORKER_TIMEOUT",
                  "SSRF_BLOCKED_TARGET",
                  "INVALID_URL",
                ].includes(renderError.code) && `Preview Error (${renderError.code})`}
              </div>
              <p>{renderError.message}</p>
            </div>
          </div>
          {renderError.code === "WORKER_TIMEOUT" && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => handleRenderWebsite()}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Dual-Pane Interactive Studio */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left: Rendered Preview Canvas */}
        <div className="flex flex-col rounded-xl border border-border bg-card lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setTool("element");
                  setDragOrigin(null);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                  tool === "element"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Crosshair className="size-3.5" aria-hidden="true" />
                Single Element
              </button>
              <button
                type="button"
                onClick={() => {
                  setTool("multi_element");
                  setDragOrigin(null);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                  tool === "multi_element"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Layers className="size-3.5" aria-hidden="true" />
                Multi-Element
              </button>
              <button
                type="button"
                onClick={() => {
                  setTool("region");
                  setHoveredElement(null);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                  tool === "region"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <BoxSelect className="size-3.5" aria-hidden="true" />
                Visual Region
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {preview?.frameBlockedByHeader && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 font-mono text-[11px] font-normal text-emerald-700 dark:text-emerald-300"
                >
                  <ShieldCheck className="mr-1 size-3" aria-hidden="true" />
                  Bypassed iframe restriction ({preview.framePolicyHeader})
                </Badge>
              )}
              {(selectedElements.length > 0 || activeBoundingBox) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setSelectedElements([]);
                    setCustomSelector("");
                    setRegionBox(null);
                  }}
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                  <span>Clear</span>
                </Button>
              )}
            </div>
          </div>

          {/* Interactive Screenshot Canvas */}
          <div className="max-h-[680px] overflow-auto bg-muted/25 p-4">
            {loadingRender ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background/70 p-8 text-center">
                <Loader2
                  className="size-6 animate-spin text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Rendering in isolated Playwright Chromium…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Validating DNS/SSRF rules, loading DOM layout, and capturing visual
                    coordinates.
                  </p>
                </div>
              </div>
            ) : preview ? (
              <div className="mx-auto" style={{ maxWidth: preview.documentDimensions.width }}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <span className="truncate max-w-md">{preview.finalUrl}</span>
                    <span>• HTTP {preview.httpStatus}</span>
                  </span>
                  <span className="font-mono tabular-nums">
                    {preview.elements.length} nodes • {preview.documentDimensions.width}×
                    {preview.documentDimensions.height}px
                  </span>
                </div>

                <div
                  ref={canvasRef}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerLeave={() => setHoveredElement(null)}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerUp={handleCanvasPointerUp}
                  onPointerCancel={clearActiveDrag}
                  onLostPointerCapture={clearActiveDrag}
                  className={cn(
                    "relative w-full select-none overflow-hidden rounded-lg border border-border bg-white shadow-xs",
                    tool === "region" ? "cursor-crosshair" : "cursor-pointer"
                  )}
                  style={{
                    aspectRatio: `${preview.documentDimensions.width} / ${preview.documentDimensions.height}`,
                    touchAction: tool === "region" ? "none" : "auto",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.screenshotDataUrl}
                    alt={`Isolated browser render of ${preview.pageTitle}`}
                    draggable={false}
                    className="pointer-events-none block h-full w-full object-fill"
                  />

                  {/* Hover highlight box */}
                  {hoveredElement && tool !== "region" && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute border-2 border-sky-500 bg-sky-500/10"
                      style={{
                        left: `${(hoveredElement.boundingBox.x / preview.documentDimensions.width) * 100}%`,
                        top: `${(hoveredElement.boundingBox.y / preview.documentDimensions.height) * 100}%`,
                        width: `${(hoveredElement.boundingBox.width / preview.documentDimensions.width) * 100}%`,
                        height: `${(hoveredElement.boundingBox.height / preview.documentDimensions.height) * 100}%`,
                      }}
                    >
                      <span className="absolute -top-5 left-0 max-w-[260px] truncate rounded-xs bg-sky-600 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white shadow-xs">
                        {hoveredElement.tag} • {hoveredElement.selector}
                      </span>
                    </div>
                  )}

                  {/* Selected element overlays */}
                  {tool !== "region" &&
                    selectedElements.map((el) => (
                      <div
                        key={el.id}
                        aria-hidden="true"
                        className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-500/15"
                        style={{
                          left: `${(el.boundingBox.x / preview.documentDimensions.width) * 100}%`,
                          top: `${(el.boundingBox.y / preview.documentDimensions.height) * 100}%`,
                          width: `${(el.boundingBox.width / preview.documentDimensions.width) * 100}%`,
                          height: `${(el.boundingBox.height / preview.documentDimensions.height) * 100}%`,
                        }}
                      />
                    ))}

                  {/* Drawn visual region box */}
                  {tool === "region" && regionBox && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-500/15"
                      style={{
                        left: `${(regionBox.x / preview.documentDimensions.width) * 100}%`,
                        top: `${(regionBox.y / preview.documentDimensions.height) * 100}%`,
                        width: `${(regionBox.width / preview.documentDimensions.width) * 100}%`,
                        height: `${(regionBox.height / preview.documentDimensions.height) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background/70 p-8 text-center">
                <Crosshair className="size-6 text-muted-foreground" aria-hidden="true" />
                <div className="max-w-md space-y-1.5">
                  <p className="text-sm font-medium text-foreground">
                    Enter a public website URL and click Load Website Preview
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    SidCrawal renders the page inside an isolated Playwright Chromium
                    process—supporting sites that block iframes via{" "}
                    <code className="font-mono">X-Frame-Options</code> or{" "}
                    <code className="font-mono">CSP frame-ancestors</code>.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Inspector & Save Panel */}
        <aside className="rounded-xl border border-border bg-card p-4 lg:col-span-4">
          <Tabs defaultValue="selection">
            <TabsList className="w-full">
              <TabsTrigger value="selection" className="flex-1">
                Selection
              </TabsTrigger>
              <TabsTrigger value="elements" className="flex-1">
                DOM Nodes ({preview?.elements.length ?? 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="selection" className="space-y-4 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="monitor-label-input">Monitor name</Label>
                <Input
                  id="monitor-label-input"
                  value={monitorName}
                  onChange={(e) => setMonitorName(e.target.value)}
                  placeholder="e.g. GitHub Pricing — Enterprise"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="workspace-interval-select">Crawl frequency</Label>
                <select
                  id="workspace-interval-select"
                  value={checkInterval}
                  onChange={(e) => setCheckInterval(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {tool !== "region" && (
                <div className="space-y-1.5">
                  <Label htmlFor="css-selector-input">CSS selector</Label>
                  <Input
                    id="css-selector-input"
                    value={customSelector}
                    onChange={(e) => setCustomSelector(e.target.value)}
                    placeholder="Click an element on the preview..."
                    className="font-mono text-xs"
                  />
                </div>
              )}

              <dl className="space-y-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Selection type</dt>
                  <dd className="font-mono text-foreground">{tool}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Viewport</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {selectionPayload.viewportDimensions.width}×
                    {selectionPayload.viewportDimensions.height}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Bounding box (px)</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-foreground">
                    {activeBoundingBox
                      ? `x:${activeBoundingBox.x}, y:${activeBoundingBox.y}, w:${activeBoundingBox.width}, h:${activeBoundingBox.height}`
                      : "None selected"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Selected element text</dt>
                  <dd className="mt-1 max-h-28 overflow-auto rounded-md border border-border bg-background p-2 text-foreground">
                    {normalizedPreviewText || (
                      <span className="text-muted-foreground">
                        Hover and click a DOM node or drag a visual region.
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2 text-xs">
                <label className="flex items-center justify-between rounded-md border border-border px-2.5 py-2">
                  <span>Collapse extra whitespace</span>
                  <input
                    type="checkbox"
                    checked={collapseWhitespace}
                    onChange={(e) => setCollapseWhitespace(e.target.checked)}
                    className="size-4 accent-emerald-600"
                  />
                </label>
                <label className="flex items-center justify-between rounded-md border border-border px-2.5 py-2">
                  <span>Normalize dynamic numbers</span>
                  <input
                    type="checkbox"
                    checked={ignoreNumbers}
                    onChange={(e) => setIgnoreNumbers(e.target.checked)}
                    className="size-4 accent-emerald-600"
                  />
                </label>
                <label className="flex items-center justify-between rounded-md border border-border px-2.5 py-2">
                  <span>Strip timestamps &amp; relative dates</span>
                  <input
                    type="checkbox"
                    checked={stripTimestamps}
                    onChange={(e) => setStripTimestamps(e.target.checked)}
                    className="size-4 accent-emerald-600"
                  />
                </label>
              </div>

              {saveError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{saveError}</span>
                </div>
              )}

              {saveSuccess && (
                <div
                  role="status"
                  className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200"
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{saveSuccess.message}</span>
                  </div>
                  <Link
                    href={`/dashboard/monitors/${saveSuccess.monitorId}`}
                    className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
                  >
                    <span>Open Monitor Details ({saveSuccess.status})</span>
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </Link>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => handleSaveMonitor(true)}
                >
                  {saving ? "Saving..." : "Save & Activate Monitor"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => handleSaveMonitor(false)}
                >
                  Save Draft Selection
                </Button>
              </div>

              <details className="rounded-lg border border-border bg-muted/20 p-2.5 text-[11px]">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  Inspect Selection JSON Payload
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto font-mono text-[10px] text-foreground">
                  {JSON.stringify(selectionPayload, null, 2)}
                </pre>
              </details>
            </TabsContent>

            <TabsContent value="elements" className="space-y-3 pt-3">
              <Input
                value={elementFilter}
                onChange={(e) => setElementFilter(e.target.value)}
                placeholder="Filter by tag, CSS selector, or text..."
                className="text-xs"
              />
              <div className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
                {filteredElements.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {preview
                      ? "No matching DOM elements found."
                      : "Load a website preview to browse extracted DOM nodes."}
                  </p>
                ) : (
                  filteredElements.map((el) => {
                    const active = selectedElements.some((s) => s.id === el.id);
                    return (
                      <button
                        key={el.id}
                        type="button"
                        onClick={() => handleSelectFromList(el)}
                        className={cn(
                          "w-full rounded-lg border p-2.5 text-left text-xs transition-colors",
                          active
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-border bg-background hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium text-emerald-700 dark:text-emerald-300">
                            &lt;{el.tag}&gt;
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                            {el.boundingBox.width}×{el.boundingBox.height}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                          {el.selector}
                        </div>
                        {el.text && (
                          <div className="mt-1 line-clamp-2 text-[11px] text-foreground">
                            {el.text}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </TabsContent>
          </Tabs>

          {!supabaseConfigured && (
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
              Preview rendering works locally right now.{" "}
              <Link
                href="/dashboard/settings"
                className={cn(buttonVariants({ variant: "link", size: "xs" }), "h-auto p-0")}
              >
                Connect Supabase
              </Link>{" "}
              to persist monitors and selections to PostgreSQL.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
