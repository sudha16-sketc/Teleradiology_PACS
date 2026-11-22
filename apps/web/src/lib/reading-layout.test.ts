import { beforeEach, describe, expect, it } from "vitest";
import {
  READING_LAYOUT_PRESETS,
  READING_LAYOUT_STORAGE_KEY,
  applyReadingLayoutPreset,
  collapseReadingPanel,
  createReadingLayout,
  defaultReadingLayout,
  expandReadingPanel,
  normalizeReadingLayout,
  readReadingLayout,
  restoreAllReadingPanels,
  writeReadingLayout,
} from "./reading-layout";

describe("reading layout state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalizes presets to a complete 100 percent layout", () => {
    for (const preset of Object.values(READING_LAYOUT_PRESETS)) {
      const layout = createReadingLayout(preset);
      const total =
        layout.sizes.viewer + layout.sizes.report + layout.sizes.patient;
      expect(total).toBeCloseTo(100, 1);
    }
  });

  it("stores the last non-zero size when a panel is collapsed", () => {
    const layout = createReadingLayout({
      viewer: 60,
      report: 25,
      patient: 15,
    });
    const collapsed = collapseReadingPanel(layout, "patient");

    expect(collapsed.collapsed.patient).toBe(true);
    expect(collapsed.sizes.patient).toBe(0);
    expect(collapsed.lastSizes.patient).toBeCloseTo(15, 1);
    expect(collapsed.sizes.viewer + collapsed.sizes.report).toBeCloseTo(100, 1);
  });

  it("restores the previous size when a panel is expanded", () => {
    const layout = createReadingLayout({
      viewer: 60,
      report: 25,
      patient: 15,
    });
    const collapsed = collapseReadingPanel(layout, "patient");
    const expanded = expandReadingPanel(collapsed, "patient");

    expect(expanded.collapsed.patient).toBe(false);
    expect(expanded.sizes.patient).toBeCloseTo(15, 1);
    expect(
      expanded.sizes.viewer + expanded.sizes.report + expanded.sizes.patient,
    ).toBeCloseTo(100, 1);
  });

  it("keeps focus presets and restore-all internally consistent", () => {
    const layout = defaultReadingLayout();
    const focused = applyReadingLayoutPreset(layout, "reportFocus");
    expect(focused.sizes.report).toBe(100);
    expect(focused.collapsed.viewer).toBe(true);
    expect(focused.collapsed.patient).toBe(true);

    const restored = restoreAllReadingPanels(focused);
    expect(restored.collapsed.viewer).toBe(false);
    expect(restored.collapsed.report).toBe(false);
    expect(restored.collapsed.patient).toBe(false);
    expect(restored.sizes.report).toBeCloseTo(
      READING_LAYOUT_PRESETS.balanced.report,
      1,
    );
  });

  it("rejects stale persisted layouts", () => {
    expect(
      normalizeReadingLayout({
        version: 999,
        sizes: { viewer: 50, report: 50, patient: 0 },
        lastSizes: { viewer: 50, report: 50, patient: 20 },
        collapsed: { viewer: false, report: false, patient: true },
        preset: "custom",
      }),
    ).toBeNull();
  });

  it("round-trips a versioned layout through storage", () => {
    const layout = createReadingLayout({
      viewer: 48,
      report: 32,
      patient: 20,
    });
    writeReadingLayout(layout);

    expect(window.localStorage.getItem(READING_LAYOUT_STORAGE_KEY)).toContain(
      '"version":1',
    );
    expect(readReadingLayout()).toEqual(layout);
  });
});
