"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Maximize2,
  Minus,
  RotateCcw,
} from "lucide-react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import {
  READING_LAYOUT_KEYBOARD_RESIZE_BY,
  READING_PANEL_COLLAPSED_SIZE,
  READING_PANEL_IDS,
  READING_PANEL_MIN_SIZES,
  applyReadingLayoutPreset,
  collapseReadingPanel,
  defaultReadingLayout,
  expandReadingPanel,
  layoutFromArray,
  layoutToArray,
  nudgeReadingLayoutBoundary,
  readReadingLayout,
  restoreAllReadingPanels,
  writeReadingLayout,
  type ReadingLayoutPreset,
  type ReadingLayoutState,
  type ReadingPanelId,
} from "@/lib/reading-layout";

type SeparatorKeyboardEvent = Pick<
  React.KeyboardEvent<HTMLElement>,
  "key" | "preventDefault" | "nativeEvent"
>;

export interface ReadingPanelsProps {
  viewer: ReactNode;
  report: ReactNode;
  patient: ReactNode;
}

const PANEL_LABELS: Record<ReadingPanelId, string> = {
  viewer: "DICOM viewer",
  report: "Report",
  patient: "Patient details",
};

const FOCUS_PRESETS: Record<ReadingPanelId, ReadingLayoutPreset> = {
  viewer: "viewerFocus",
  report: "reportFocus",
  patient: "patientFocus",
};

const PRESET_BUTTONS: { id: ReadingLayoutPreset; label: string }[] = [
  { id: "balanced", label: "Balanced" },
  { id: "viewerFocus", label: "Viewer focus" },
  { id: "reportFocus", label: "Report focus" },
  { id: "patientFocus", label: "Patient focus" },
  { id: "viewerReport", label: "Viewer + report" },
  { id: "viewerPatient", label: "Viewer + patient" },
  { id: "reportPatient", label: "Report + patient" },
];

const PANEL_ORDER = [...READING_PANEL_IDS];

const controlButtonClass =
  "inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary";

const presetButtonClass =
  "whitespace-nowrap rounded border px-2 py-1 text-[11px] font-medium transition-colors";

const handleClass = (compact: boolean) =>
  `group relative shrink-0 bg-border/70 transition-colors hover:bg-accent/70 focus-visible:bg-accent data-[resize-handle-active]:bg-accent ${
    compact
      ? "h-2 w-full cursor-row-resize"
      : "h-full w-2 cursor-col-resize"
  }`;

const readStoredLayout = () => readReadingLayout() ?? defaultReadingLayout();

export function ReadingPanels({ viewer, report, patient }: ReadingPanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<ImperativePanelGroupHandle>(null);
  const layoutRef = useRef<ReadingLayoutState>(defaultReadingLayout());
  const pendingRef = useRef<ReadingLayoutState | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  const mountedRef = useRef(false);
  const [layout, setLayout] = useState<ReadingLayoutState>(layoutRef.current);
  const [hydrated, setHydrated] = useState(false);
  const [compact, setCompact] = useState(false);

  const flushPending = useCallback(() => {
    if (!readyRef.current || !groupRef.current || !pendingRef.current) return;

    const next = pendingRef.current;
    pendingRef.current = null;
    if (pendingFrameRef.current !== null) {
      cancelAnimationFrame(pendingFrameRef.current);
    }
    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;
      if (!mountedRef.current || !groupRef.current) return;
      groupRef.current.setLayout(layoutToArray(next));
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const stored = readStoredLayout();
    layoutRef.current = stored;
    setLayout(stored);
    setHydrated(true);
    pendingRef.current = stored;
    flushPending();
    return () => {
      mountedRef.current = false;
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
      }
    };
  }, [flushPending]);

  useEffect(() => {
    if (!hydrated) return;
    const frame = requestAnimationFrame(() => {
      writeReadingLayout(layoutRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, hydrated]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? Number.POSITIVE_INFINITY;
      setCompact(width < 900);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const applyState = useCallback(
    (next: ReadingLayoutState) => {
      layoutRef.current = next;
      setLayout(next);
      pendingRef.current = next;
      flushPending();
    },
    [flushPending],
  );

  const handleLayout = useCallback(
    (sizes: number[]) => {
      readyRef.current = true;
      const next = layoutFromArray(sizes, layoutRef.current);
      layoutRef.current = next;
      setLayout(next);
      if (pendingRef.current) flushPending();
    },
    [flushPending],
  );

  const handleBoundaryKeyDown = useCallback(
    (event: SeparatorKeyboardEvent, boundaryIndex: number) => {
      const step = READING_LAYOUT_KEYBOARD_RESIZE_BY;
      let delta: number | null = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") delta = -step;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") delta = step;
      if (event.key === "Home") delta = -100;
      if (event.key === "End") delta = 100;
      if (delta === null) return;

      event.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
      applyState(
        nudgeReadingLayoutBoundary(layoutRef.current, boundaryIndex, delta),
      );
    },
    [applyState],
  );

  const handleCollapse = useCallback(
    (id: ReadingPanelId) => {
      applyState(collapseReadingPanel(layoutRef.current, id));
    },
    [applyState],
  );

  const handleExpand = useCallback(
    (id: ReadingPanelId) => {
      applyState(expandReadingPanel(layoutRef.current, id));
    },
    [applyState],
  );

  const handleFocus = useCallback(
    (id: ReadingPanelId) => {
      applyState(applyReadingLayoutPreset(layoutRef.current, FOCUS_PRESETS[id]));
    },
    [applyState],
  );

  const handlePreset = useCallback(
    (preset: ReadingLayoutPreset) => {
      applyState(applyReadingLayoutPreset(layoutRef.current, preset));
    },
    [applyState],
  );

  const handleRestoreAll = useCallback(() => {
    applyState(restoreAllReadingPanels(layoutRef.current));
  }, [applyState]);

  const renderPanel = (id: ReadingPanelId, content: ReactNode) => {
    const collapsed = layout.collapsed[id];
    return (
      <Panel
        id={id}
        order={PANEL_ORDER.indexOf(id)}
        defaultSize={layout.sizes[id]}
        minSize={READING_PANEL_MIN_SIZES[id]}
        maxSize={100}
        collapsedSize={READING_PANEL_COLLAPSED_SIZE}
        collapsible
        data-testid={`reading-panel-${id}`}
      >
        <section
          aria-label={`${PANEL_LABELS[id]} panel`}
          aria-hidden={collapsed}
          data-testid={`panel-frame-${id}`}
          className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface ${
            collapsed ? "pointer-events-none" : ""
          }`}
        >
          <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
            <h2 className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {PANEL_LABELS[id]}
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              {collapsed ? (
                <button
                  type="button"
                  className={controlButtonClass}
                  onClick={() => handleExpand(id)}
                  aria-label={`Restore ${PANEL_LABELS[id]} panel`}
                  title={`Restore ${PANEL_LABELS[id]}`}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className={controlButtonClass}
                  onClick={() => handleCollapse(id)}
                  aria-label={`Minimize ${PANEL_LABELS[id]} panel`}
                  title={`Minimize ${PANEL_LABELS[id]}`}
                >
                  <Minus size={13} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className={controlButtonClass}
                onClick={() => handleFocus(id)}
                aria-label={`Maximize ${PANEL_LABELS[id]} panel`}
                title={`Maximize ${PANEL_LABELS[id]}`}
              >
                <Maximize2 size={13} aria-hidden="true" />
              </button>
            </div>
          </header>
          <div
            className={`min-h-0 flex-1 ${
              id === "viewer" ? "overflow-hidden" : "overflow-y-auto"
            }`}
          >
            {content}
          </div>
        </section>
      </Panel>
    );
  };

  return (
    <div
      ref={containerRef}
      className="flex h-[85dvh] min-h-[640px] flex-col gap-2 lg:h-[calc(100dvh-3rem)] lg:min-h-0"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-raised px-2 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Layout
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {PRESET_BUTTONS.map((preset) => {
            const active = layout.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => handlePreset(preset.id)}
                className={`${presetButtonClass} ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-text-muted hover:text-text-primary"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleRestoreAll}
          className={`${presetButtonClass} border-border bg-surface text-text-primary hover:text-accent`}
        >
          Restore all
        </button>
        <span className="ml-auto hidden text-[11px] text-text-muted xl:block">
          Drag dividers, or focus a divider and use arrow keys
        </span>
      </div>

      <PanelGroup
        ref={groupRef}
        direction={compact ? "vertical" : "horizontal"}
        onLayout={handleLayout}
        keyboardResizeBy={READING_LAYOUT_KEYBOARD_RESIZE_BY}
        className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-surface"
      >
        {renderPanel("viewer", viewer)}
        <PanelResizeHandle
          aria-label="Resize DICOM viewer and report panels"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(layout.sizes.viewer)}
          onKeyDownCapture={(event) => handleBoundaryKeyDown(event, 0)}
          className={handleClass(compact)}
        />
        {renderPanel("report", report)}
        <PanelResizeHandle
          aria-label="Resize report and patient details panels"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(
            layout.sizes.viewer + layout.sizes.report,
          )}
          onKeyDownCapture={(event) => handleBoundaryKeyDown(event, 1)}
          className={handleClass(compact)}
        />
        {renderPanel("patient", patient)}
      </PanelGroup>
    </div>
  );
}
