import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { apiClient } from "@/lib/api-client";
import { StudyHistoryDialog } from "./StudyHistoryDialog";

vi.mock("@/lib/api-client", () => ({
  apiClient: { get: vi.fn() },
  failureOf: (error: unknown) =>
    error instanceof Error ? { message: error.message } : { message: "Failed" },
}));

describe("StudyHistoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the selected study history and exposes its private attachment link", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        studyInstanceUid: "1.2.3",
        patientName: "History Test",
        patientAge: 54,
        gender: "F",
        referringPhysician: "Dr. Example",
        clinicalHistory: "Symptoms and relevant history.",
        attachment: {
          id: "attachment-1",
          originalName: "supporting-notes.pdf",
          mimeType: "application/pdf",
          sizeBytes: 120,
        },
      },
    });

    render(
      <StudyHistoryDialog studyUid="1.2.3" onClose={() => undefined} />,
    );

    expect(await screen.findByText("History Test")).toBeTruthy();
    expect(screen.getByText("54")).toBeTruthy();
    expect(screen.getByText("Symptoms and relevant history.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /supporting-notes\.pdf/i }).getAttribute("href"),
    ).toContain("/api/studies/history-attachments/attachment-1");
    expect(apiClient.get).toHaveBeenCalledWith("/studies/1.2.3/history");
  });
});
