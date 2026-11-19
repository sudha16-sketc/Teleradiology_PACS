import { describe, expect, it } from "vitest";
import {
  hasReportBodyContent,
  htmlToPlainText,
  reportBodyHtml,
  sanitizeReportHtml,
} from "./report-html";

const REPORT = {
  contentHtml:
    "<h2>Clinical History</h2><p>CH-EDITED</p>" +
    "<h2>Technique</h2><p>TECHNIQUE-EDITED</p>" +
    "<h2>Comparison</h2><p>COMPARISON-EDITED</p>" +
    "<h2>Findings</h2><p>FINDINGS-EDITED</p>" +
    "<h2>Impression</h2><p>IMPRESSION-EDITED</p>" +
    "<h2>Recommendations</h2><p>RECOMMENDATIONS-EDITED</p>",
  clinicalHistory: "CH-OLD",
  technique: "TECHNIQUE-OLD",
  comparison: "COMPARISON-OLD",
  findings: "FINDINGS-OLD",
  impression: "IMPRESSION-OLD",
  recommendations: "RECOMMENDATIONS-OLD",
};

const BLANK_HEADINGS =
  "<h2>Clinical History</h2><p><br /></p>" +
  "<h2>Technique</h2><p><br /></p>" +
  "<h2>Comparison</h2><p><br /></p>" +
  "<h2>Findings</h2><p><br /></p>" +
  "<h2>Impression</h2><p><br /></p>" +
  "<h2>Recommendations</h2><p><br /></p>";

describe("report body rendering", () => {
  it("uses rich content when section bodies contain saved text", () => {
    expect(hasReportBodyContent(REPORT.contentHtml)).toBe(true);
    const html = reportBodyHtml(REPORT);
    expect(html).toContain("CH-EDITED");
    expect(html).toContain("TECHNIQUE-EDITED");
    expect(html).toContain("COMPARISON-EDITED");
    expect(html).toContain("FINDINGS-EDITED");
    expect(html).toContain("IMPRESSION-EDITED");
    expect(html).toContain("RECOMMENDATIONS-EDITED");
    expect(html).not.toContain("CH-OLD");
  });

  it("falls back to structured fields for heading-only rich HTML", () => {
    expect(hasReportBodyContent(BLANK_HEADINGS)).toBe(false);
    const html = reportBodyHtml({ ...REPORT, contentHtml: BLANK_HEADINGS });
    const text = htmlToPlainText(html);
    expect(text).toContain("Clinical History");
    expect(text).toContain("CH-OLD");
    expect(text).toContain("Technique");
    expect(text).toContain("TECHNIQUE-OLD");
    expect(text).toContain("Comparison");
    expect(text).toContain("COMPARISON-OLD");
    expect(text).toContain("Findings");
    expect(text).toContain("FINDINGS-OLD");
    expect(text).toContain("Impression");
    expect(text).toContain("IMPRESSION-OLD");
    expect(text).toContain("Recommendations");
    expect(text).toContain("RECOMMENDATIONS-OLD");
  });

  it("sanitizes scripts while preserving saved section content", () => {
    const html = sanitizeReportHtml(
      '<h2>Findings</h2><p>FINDINGS-EDITED</p><script>alert(1)</script>',
    );
    expect(html).toContain("FINDINGS-EDITED");
    expect(html).not.toContain("<script>");
  });
});
