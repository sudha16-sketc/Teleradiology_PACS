import { describe, expect, it } from "vitest";

import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  validateSelection,
} from "./dicom-selection";

describe("DICOM selection budgets", () => {
  it("keeps distinct same-named desktop files and removes repeated paths", () => {
    const result = validateSelection([
      { name: "IM0001.dcm", size: 10, path: "C:\\study-a\\IM0001.dcm" },
      { name: "IM0001.dcm", size: 10, path: "C:\\study-b\\IM0001.dcm" },
      { name: "IM0001.dcm", size: 10, path: "C:\\study-a\\IM0001.dcm" },
    ]);

    expect(result).toMatchObject({ ok: true, skipped: 1 });
    if (result.ok) expect(result.files).toHaveLength(2);
  });

  it("rejects disallowed types, oversized files, oversized totals, and excessive counts", () => {
    expect(validateSelection([{ name: "report.pdf", size: 1 }])).toMatchObject({
      ok: false,
      code: "empty",
    });
    expect(
      validateSelection([{ name: "large.dcm", size: MAX_FILE_BYTES + 1 }]),
    ).toMatchObject({ ok: false, code: "file_too_large" });
    expect(
      validateSelection([
        { name: "a.dcm", size: MAX_TOTAL_BYTES / 2 },
        { name: "b.dcm", size: MAX_TOTAL_BYTES / 2 + 1 },
      ]),
    ).toMatchObject({ ok: false, code: "total_too_large" });
    expect(
      validateSelection(
        Array.from({ length: MAX_FILES + 1 }, (_, index) => ({
          name: `${index}.dcm`,
          size: 1,
        })),
      ),
    ).toMatchObject({ ok: false, code: "too_many" });
  });
});