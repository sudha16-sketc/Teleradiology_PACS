export const REPORT_RICH_SECTIONS = [
  { key: "clinicalHistory", label: "Clinical History" },
  { key: "technique", label: "Technique" },
  { key: "comparison", label: "Comparison" },
  { key: "findings", label: "Findings" },
  { key: "impression", label: "Impression" },
  { key: "recommendations", label: "Recommendations" },
] as const;

export type ReportRichSectionKey =
  (typeof REPORT_RICH_SECTIONS)[number]["key"];

export type ReportRichValue =
  | string
  | number
  | boolean
  | null
  | ReportRichValue[]
  | { [key: string]: ReportRichValue };

export interface ReportRichMark {
  type: string;
  attrs?: Record<string, ReportRichValue>;
}

export interface ReportRichNode {
  type: string;
  attrs?: Record<string, ReportRichValue>;
  content?: ReportRichNode[];
  marks?: ReportRichMark[];
  text?: string;
}

export interface ReportRichContent extends ReportRichNode {
  type: "doc";
  content: ReportRichNode[];
}

export type ReportRichFields = Record<ReportRichSectionKey, string>;

const NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "hardBreak",
  "horizontalRule",
  "text",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "reportSection",
]);

const MARK_TYPES = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "textStyle",
]);

const FONT_FAMILIES = new Set([
  "Arial",
  "Calibri",
  "Georgia",
  "Times New Roman",
  "Verdana",
]);

const MAX_CONTENT_BYTES = 256_000;
const MAX_NODE_COUNT = 10_000;
const MAX_DEPTH = 64;

export function buildReportRichContent(
  fields: Partial<ReportRichFields>,
): ReportRichContent {
  return {
    type: "doc",
    content: REPORT_RICH_SECTIONS.map(({ key, label }) => ({
      type: "reportSection",
      attrs: { section: key },
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: label }],
        },
        ...paragraphs(fields[key] ?? ""),
      ],
    })),
  };
}

export function extractReportRichFields(
  document: ReportRichContent,
): ReportRichFields {
  const fields = Object.fromEntries(
    REPORT_RICH_SECTIONS.map(({ key }) => [key, ""]),
  ) as ReportRichFields;

  for (const value of document.content) {
    if (!isRecord(value) || value.type !== "reportSection") continue;
    const section = value.attrs;
    if (!isRecord(section) || !isReportRichSectionKey(section.section)) {
      continue;
    }

    const blocks = Array.isArray(value.content) ? value.content : [];
    fields[section.section] = blocks
      .filter((block) => !isRecord(block) || block.type !== "heading")
      .map(textFromNode)
      .join("\n")
      .replace(/\n+$/, "");
  }

  return fields;
}

export function isReportRichContent(
  value: unknown,
): value is ReportRichContent {
  if (!isRecord(value) || value.type !== "doc" || !Array.isArray(value.content)) {
    return false;
  }

  let nodeCount = 0;
  if (!value.content.every((node) => isRichNode(node, 1, () => ++nodeCount))) {
    return false;
  }
  if (nodeCount > MAX_NODE_COUNT) return false;

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_CONTENT_BYTES;
  } catch {
    return false;
  }
}

function isRichNode(
  value: unknown,
  depth: number,
  countNode: () => number,
): value is ReportRichNode {
  if (
    !isRecord(value) ||
    depth > MAX_DEPTH ||
    countNode() > MAX_NODE_COUNT ||
    typeof value.type !== "string" ||
    !NODE_TYPES.has(value.type)
  ) {
    return false;
  }

  if (
    Object.keys(value).some(
      (key) => !["type", "attrs", "content", "text", "marks"].includes(key),
    )
  ) {
    return false;
  }

  if (value.type === "text") {
    if (typeof value.text !== "string" || value.content !== undefined) return false;
  } else if (value.text !== undefined) {
    return false;
  }

  if (
    value.content !== undefined &&
    (!Array.isArray(value.content) ||
      !value.content.every((node) => isRichNode(node, depth + 1, countNode)))
  ) {
    return false;
  }

  if (
    value.type === "reportSection" &&
    (!Array.isArray(value.content) ||
      value.content[0]?.type !== "heading" ||
      !isRecord(value.attrs) ||
      !isReportRichSectionKey(value.attrs.section))
  ) {
    return false;
  }

  if (
    value.marks !== undefined &&
    (!Array.isArray(value.marks) || !value.marks.every(isRichMark))
  ) {
    return false;
  }

  return (
    value.attrs === undefined ||
    (isRecord(value.attrs) && isAllowedAttributes(value.type, value.attrs))
  );
}

function isRichMark(value: unknown): value is ReportRichMark {
  if (!isRecord(value) || typeof value.type !== "string" || !MARK_TYPES.has(value.type)) {
    return false;
  }
  if (Object.keys(value).some((key) => !["type", "attrs"].includes(key))) {
    return false;
  }
  if (value.type !== "textStyle") return value.attrs === undefined;
  return (
    isRecord(value.attrs) &&
    Object.keys(value.attrs).length === 1 &&
    typeof value.attrs.fontFamily === "string" &&
    FONT_FAMILIES.has(value.attrs.fontFamily)
  );
}

function isAllowedAttributes(
  type: string,
  value: Record<string, unknown>,
): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return type !== "heading" && type !== "reportSection";

  if (type === "heading") {
    return (
      keys.includes("level") &&
      keys.every((key) => key === "level" || key === "textAlign") &&
      Number.isInteger(value.level) &&
      Number(value.level) >= 1 &&
      Number(value.level) <= 3 &&
      isAllowedTextAlign(value.textAlign)
    );
  }
  if (type === "reportSection") {
    return (
      keys.length === 1 &&
      isReportRichSectionKey(value.section)
    );
  }
  if (type === "paragraph") {
    return (
      keys.length === 1 &&
      keys[0] === "textAlign" &&
      isAllowedTextAlign(value.textAlign)
    );
  }
  if (type === "orderedList") {
    return (
      keys.length === 1 &&
      Number.isInteger(value.start) &&
      Number(value.start) > 0
    );
  }
  if (type === "tableCell" || type === "tableHeader") {
    return (
      keys.every((key) => ["colspan", "rowspan", "colwidth"].includes(key)) &&
      (value.colspan === undefined ||
        (Number.isInteger(value.colspan) && Number(value.colspan) > 0)) &&
      (value.rowspan === undefined ||
        (Number.isInteger(value.rowspan) && Number(value.rowspan) > 0)) &&
      (value.colwidth === undefined ||
        value.colwidth === null ||
        (Array.isArray(value.colwidth) &&
          value.colwidth.every(
            (width) => width === null || (Number.isInteger(width) && Number(width) > 0),
          )))
    );
  }
  return false;
}

function isAllowedTextAlign(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    ["left", "center", "right", "justify"].includes(String(value))
  );
}

function paragraphs(value: string): ReportRichNode[] {
  return value.split(/\r?\n/).map((text) => ({
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  }));
}

function textFromNode(value: ReportRichNode | ReportRichValue): string {
  if (!isRecord(value)) return "";
  if (value.type === "text") return typeof value.text === "string" ? value.text : "";
  if (value.type === "hardBreak") return "\n";

  const children = Array.isArray(value.content) ? value.content : [];
  const separator =
    value.type === "tableRow"
      ? "\t"
      : value.type === "table" ||
          value.type === "bulletList" ||
          value.type === "orderedList"
        ? "\n"
        : "";
  return children.map(textFromNode).join(separator);
}

function isReportRichSectionKey(value: unknown): value is ReportRichSectionKey {
  return REPORT_RICH_SECTIONS.some(({ key }) => key === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
