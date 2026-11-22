export type ReadingPanelId = "viewer" | "report" | "patient";

export type ReadingPanelSizes = Record<ReadingPanelId, number>;

export type ReadingLayoutPreset =
  | "balanced"
  | "viewerFocus"
  | "reportFocus"
  | "patientFocus"
  | "viewerReport"
  | "viewerPatient"
  | "reportPatient";

export type ReadingLayoutState = {
  version: number;
  sizes: ReadingPanelSizes;
  collapsed: Record<ReadingPanelId, boolean>;
  lastSizes: ReadingPanelSizes;
  preset: ReadingLayoutPreset | "custom";
};

export const READING_LAYOUT_VERSION = 1;

export const READING_LAYOUT_STORAGE_KEY = "axis.reading.layout";

export const READING_PANEL_IDS: readonly ReadingPanelId[] = [
  "viewer",
  "report",
  "patient",
];

export const READING_PANEL_COLLAPSED_SIZE = 0;

export const READING_PANEL_MIN_SIZES: ReadingPanelSizes = {
  viewer: 10,
  report: 14,
  patient: 10,
};

export const READING_LAYOUT_KEYBOARD_RESIZE_BY = 2;

export const READING_LAYOUT_PRESETS: Record<
  ReadingLayoutPreset,
  ReadingPanelSizes
> = {
  balanced: { viewer: 56, report: 28, patient: 16 },
  viewerFocus: { viewer: 100, report: 0, patient: 0 },
  reportFocus: { viewer: 0, report: 100, patient: 0 },
  patientFocus: { viewer: 0, report: 0, patient: 100 },
  viewerReport: { viewer: 50, report: 50, patient: 0 },
  viewerPatient: { viewer: 50, report: 0, patient: 50 },
  reportPatient: { viewer: 0, report: 50, patient: 50 },
};

const ZERO_SIZES: ReadingPanelSizes = { viewer: 0, report: 0, patient: 0 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const roundOne = (value: number) => Math.round(value * 10) / 10;

const sumSizes = (sizes: ReadingPanelSizes) =>
  READING_PANEL_IDS.reduce((total, id) => total + sizes[id], 0);

const emptySizes = (): ReadingPanelSizes => ({ ...ZERO_SIZES });

const copySizes = (sizes: ReadingPanelSizes): ReadingPanelSizes => ({
  viewer: sizes.viewer,
  report: sizes.report,
  patient: sizes.patient,
});

const normalizeValues = (values: ReadingPanelSizes): ReadingPanelSizes => {
  const visible = READING_PANEL_IDS.filter((id) => values[id] > 0);
  if (visible.length === 0) return emptySizes();

  for (const id of visible) {
    values[id] = Math.max(values[id], READING_PANEL_MIN_SIZES[id]);
  }

  let total = sumSizes(values);
  if (total > 100) {
    const adjustable = visible.filter(
      (id) => values[id] > READING_PANEL_MIN_SIZES[id],
    );
    const capacity = adjustable.reduce(
      (sum, id) => sum + values[id] - READING_PANEL_MIN_SIZES[id],
      0,
    );
    const excess = total - 100;
    if (capacity > 0) {
      for (const id of adjustable) {
        values[id] -=
          (excess * (values[id] - READING_PANEL_MIN_SIZES[id])) / capacity;
      }
    } else {
      for (const id of visible) values[id] = (values[id] / total) * 100;
    }
  } else if (total < 100) {
    const capacity = visible.reduce((sum, id) => sum + values[id], 0);
    const deficit = 100 - total;
    if (capacity > 0) {
      for (const id of visible) values[id] += (deficit * values[id]) / capacity;
    } else {
      for (const id of visible) values[id] = 100 / visible.length;
    }
  }

  total = sumSizes(values);
  for (const id of visible) values[id] = roundOne(clamp(values[id], 0, 100));

  const roundedTotal = sumSizes(values);
  if (roundedTotal !== 100 && visible.length > 0) {
    const largest = visible.reduce((chosen, id) =>
      values[id] > values[chosen] ? id : chosen,
    );
    values[largest] = roundOne(
      clamp(values[largest] + (100 - roundedTotal), 0, 100),
    );
  }

  for (const id of READING_PANEL_IDS) {
    if (!visible.includes(id)) values[id] = 0;
  }

  return values;
};

const scaleWeights = (
  ids: readonly ReadingPanelId[],
  weights: ReadingPanelSizes,
  total: number,
): ReadingPanelSizes => {
  const result = emptySizes();
  if (ids.length === 0) return result;

  const capacity = ids.reduce((sum, id) => sum + Math.max(0, weights[id]), 0);
  for (const id of ids) {
    result[id] =
      capacity > 0 ? (total * Math.max(0, weights[id])) / capacity : total / ids.length;
  }
  return normalizeValues(result);
};

const distributeWeights = (
  ids: readonly ReadingPanelId[],
  weights: ReadingPanelSizes,
  total: number,
): ReadingPanelSizes => {
  const result = emptySizes();
  if (ids.length === 0) return result;

  const capacity = ids.reduce((sum, id) => sum + Math.max(0, weights[id]), 0);
  for (const id of ids) {
    result[id] =
      capacity > 0 ? (total * Math.max(0, weights[id])) / capacity : total / ids.length;
  }
  return result;
};

const finalizeLastSizes = (sizes: ReadingPanelSizes): ReadingPanelSizes => {
  const result = emptySizes();
  for (const id of READING_PANEL_IDS) {
    result[id] = roundOne(Math.max(0.1, sizes[id]));
  }

  const total = sumSizes(result);
  const largest = READING_PANEL_IDS.reduce((chosen, id) =>
    result[id] > result[chosen] ? id : chosen,
  );
  result[largest] = roundOne(
    Math.max(0.1, result[largest] + (100 - total)),
  );
  return result;
};

const normalizeSizeInput = (input: unknown): ReadingPanelSizes => {
  const source = isRecord(input) ? input : {};
  const result = emptySizes();
  for (const id of READING_PANEL_IDS) {
    const value = source[id];
    result[id] =
      typeof value === "number" && Number.isFinite(value)
        ? clamp(value, 0, 100)
        : 0;
  }
  return result;
};

const normalizeSizes = (
  input: unknown,
  fallback: ReadingPanelSizes,
): ReadingPanelSizes => {
  const values = normalizeSizeInput(input);
  if (sumSizes(values) === 0) {
    const fallbackValues = normalizeSizeInput(fallback);
    if (sumSizes(fallbackValues) === 0) return emptySizes();
    return normalizeValues(
      scaleWeights(
        READING_PANEL_IDS,
        fallbackValues,
        100,
      ),
    );
  }
  return normalizeValues(values);
};

const normalizeLastSizes = (
  input: unknown,
  fallback: ReadingPanelSizes,
): ReadingPanelSizes => {
  const values = normalizeSizeInput(input);
  const result = emptySizes();
  for (const id of READING_PANEL_IDS) {
    result[id] = values[id] > 0 ? values[id] : fallback[id];
  }
  return normalizeValues(
    scaleWeights(READING_PANEL_IDS, result, 100),
  );
};

const deriveCollapsed = (sizes: ReadingPanelSizes) => ({
  viewer: sizes.viewer === 0,
  report: sizes.report === 0,
  patient: sizes.patient === 0,
});

export const createReadingLayout = (
  sizes: ReadingPanelSizes,
  preset: ReadingLayoutPreset | "custom" = "custom",
  lastSizes?: ReadingPanelSizes,
): ReadingLayoutState => {
  const normalizedSizes = normalizeSizes(sizes, READING_LAYOUT_PRESETS.balanced);
  const candidateLastSizes = normalizeLastSizes(
    lastSizes,
    normalizedSizes,
  );
  const visible = READING_PANEL_IDS.filter((id) => normalizedSizes[id] > 0);
  const hidden = READING_PANEL_IDS.filter((id) => normalizedSizes[id] === 0);
  const hiddenTotal = hidden.reduce(
    (sum, id) => sum + candidateLastSizes[id],
    0,
  );
  const nextLastSizes = copySizes(candidateLastSizes);

  if (visible.length > 0 && hidden.length > 0) {
    const scaledVisible = distributeWeights(
      visible,
      candidateLastSizes,
      100 - hiddenTotal,
    );
    for (const id of visible) nextLastSizes[id] = scaledVisible[id];
  }

  return {
    version: READING_LAYOUT_VERSION,
    sizes: normalizedSizes,
    collapsed: deriveCollapsed(normalizedSizes),
    lastSizes: finalizeLastSizes(nextLastSizes),
    preset,
  };
};

export const defaultReadingLayout = (): ReadingLayoutState =>
  createReadingLayout(READING_LAYOUT_PRESETS.balanced, "balanced");

export const normalizeReadingLayout = (value: unknown): ReadingLayoutState | null => {
  if (!isRecord(value) || value.version !== READING_LAYOUT_VERSION) return null;

  const sizes = normalizeSizes(value.sizes, READING_LAYOUT_PRESETS.balanced);
  const lastSizes = normalizeLastSizes(value.lastSizes, sizes);
  const preset =
    typeof value.preset === "string" && value.preset in READING_LAYOUT_PRESETS
      ? (value.preset as ReadingLayoutPreset)
      : "custom";

  return {
    version: READING_LAYOUT_VERSION,
    sizes,
    collapsed: deriveCollapsed(sizes),
    lastSizes,
    preset,
  };
};

export const readReadingLayout = (): ReadingLayoutState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(READING_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    return normalizeReadingLayout(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const writeReadingLayout = (state: ReadingLayoutState): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      READING_LAYOUT_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    return;
  }
};

export const layoutToArray = (state: ReadingLayoutState): number[] =>
  READING_PANEL_IDS.map((id) => state.sizes[id]);

export const layoutFromArray = (
  layout: number[],
  previous?: ReadingLayoutState,
): ReadingLayoutState => {
  const input = READING_PANEL_IDS.reduce<Record<string, number>>(
    (result, id, index) => {
      result[id] = layout[index] ?? 0;
      return result;
    },
    {},
  );
  return createReadingLayout(
    normalizeSizeInput(input),
    "custom",
    previous?.lastSizes,
  );
};

export const applyReadingLayoutPreset = (
  state: ReadingLayoutState,
  preset: ReadingLayoutPreset,
): ReadingLayoutState =>
  createReadingLayout(READING_LAYOUT_PRESETS[preset], preset, state.lastSizes);

export const collapseReadingPanel = (
  state: ReadingLayoutState,
  id: ReadingPanelId,
): ReadingLayoutState => {
  if (state.collapsed[id]) return state;

  const visible = READING_PANEL_IDS.filter(
    (panelId) => panelId !== id && !state.collapsed[panelId],
  );
  if (visible.length === 0) return state;

  const targetWeights = scaleWeights(
    visible,
    state.sizes,
    100,
  );
  const nextSizes = emptySizes();
  for (const panelId of visible) nextSizes[panelId] = targetWeights[panelId];

  return createReadingLayout(
    nextSizes,
    "custom",
    { ...state.lastSizes, [id]: state.sizes[id] },
  );
};

export const expandReadingPanel = (
  state: ReadingLayoutState,
  id: ReadingPanelId,
): ReadingLayoutState => {
  if (!state.collapsed[id]) return state;

  const visible = READING_PANEL_IDS.filter(
    (panelId) => panelId !== id && !state.collapsed[panelId],
  );
  const targetSize = clamp(
    state.lastSizes[id] || READING_LAYOUT_PRESETS.balanced[id],
    READING_PANEL_MIN_SIZES[id],
    100,
  );
  const remaining = visible.length === 0 ? 0 : 100 - targetSize;
  const scaledVisible = distributeWeights(visible, state.sizes, remaining);
  const nextSizes = copySizes(scaledVisible);
  nextSizes[id] = targetSize;

  return createReadingLayout(nextSizes, "custom", state.lastSizes);
};

export const nudgeReadingLayoutBoundary = (
  state: ReadingLayoutState,
  boundaryIndex: number,
  delta: number,
): ReadingLayoutState => {
  const leftId = READING_PANEL_IDS[boundaryIndex];
  const rightId = READING_PANEL_IDS[boundaryIndex + 1];
  if (!leftId || !rightId || delta === 0) return state;

  const total = state.sizes[leftId] + state.sizes[rightId];
  if (total === 0) return state;

  const minLeft = state.collapsed[leftId]
    ? 0
    : READING_PANEL_MIN_SIZES[leftId];
  const minRight = state.collapsed[rightId]
    ? 0
    : READING_PANEL_MIN_SIZES[rightId];
  const nextLeft = clamp(
    state.sizes[leftId] + delta,
    minLeft,
    Math.max(minLeft, total - minRight),
  );
  const nextSizes = copySizes(state.sizes);
  nextSizes[leftId] = nextLeft;
  nextSizes[rightId] = total - nextLeft;

  return createReadingLayout(nextSizes, "custom", state.lastSizes);
};

export const restoreAllReadingPanels = (
  state: ReadingLayoutState,
): ReadingLayoutState => applyReadingLayoutPreset(state, "balanced");
