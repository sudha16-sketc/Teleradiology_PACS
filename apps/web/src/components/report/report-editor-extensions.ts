import { mergeAttributes, Node } from "@tiptap/core";
import FontFamily from "@tiptap/extension-font-family";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { PAGE_SIZES, PaginationPlus } from "tiptap-pagination-plus";
import type { Study } from "@axis/types";

const ReportSection = Node.create({
  name: "reportSection",
  group: "block",
  content: "heading block*",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      section: {
        default: "clinicalHistory",
        parseHTML: (element) => element.getAttribute("data-report-section"),
        renderHTML: (attributes) => ({
          "data-report-section": attributes.section,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "section[data-report-section]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "section",
      mergeAttributes(HTMLAttributes, { class: "report-section" }),
      0,
    ];
  },
});

export function createReportEditorExtensions(study: Study) {
  const patient = study.patient;
  const patientName = escapeHtml(patient?.displayName ?? "Not provided");
  const patientId = escapeHtml(patient?.patientId ?? "Not provided");
  const accession = escapeHtml(study.accessionNumber);
  const modality = escapeHtml(study.modality);
  const description = escapeHtml(study.studyDescription || study.bodyPart);
  const studyDate = escapeHtml(dateOnly(study.studyDate));

  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      link: false,
      underline: false,
    }),
    Underline,
    TextStyle,
    FontFamily.configure({ types: ["textStyle"] }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TableKit,
    ReportSection,
    PaginationPlus.configure({
      ...PAGE_SIZES.A4,
      enabled: true,
      pageGap: 28,
      pageGapBorderSize: 1,
      pageGapBorderColor: "#cbd5e1",
      pageBreakBackground: "#e2e8f0",
      contentMarginTop: 16,
      contentMarginBottom: 16,
      headerLeft:
        "<strong>AXIS RADIOLOGY</strong><br><span>Clinical Imaging Report</span>",
      headerRight:
        `<span>Patient: ${patientName} | ID: ${patientId}</span><br>` +
        `<span>${modality} | ${description} | ${accession} | ${studyDate}</span>`,
      footerLeft:
        "<span>Confidential medical record | Contact: [Company contact details]</span>",
      footerRight: "Page {page}",
    }),
  ];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function dateOnly(value?: string | null): string {
  return value ? value.slice(0, 10) : "";
}
