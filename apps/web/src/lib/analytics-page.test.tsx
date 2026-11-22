import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api-client";
import { downloadMisReport } from "@/lib/mis-export";
import AnalyticsPage from "../app/(dashboard)/analytics/page";

vi.mock("@/lib/api-client", () => ({
  apiClient: { get: vi.fn() },
  failureOf: (error: unknown) =>
    error instanceof Error ? { message: error.message } : { message: "Failed" },
}));

vi.mock("@/lib/mis-export", () => ({
  downloadMisReport: vi.fn(),
}));

vi.mock("@/components/hospital/MetricCard", () => ({
  MetricCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/ui/EmptyState", () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe("Analytics MIS export action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        data: {
          totalStudies: 0,
          studiesToday: 0,
          averageTAT: 0,
          slaComplianceRate: 0,
          backlogCount: 0,
          deliverySuccessRate: 0,
        },
      } as never)
      .mockResolvedValueOnce({ data: [] } as never)
      .mockResolvedValueOnce({ data: [] } as never);
    vi.mocked(downloadMisReport).mockResolvedValue(undefined);
  });

  it("shows Export Excel and triggers the browser download flow", async () => {
    render(<AnalyticsPage />);

    const button = await screen.findByRole("button", { name: "Export Excel" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(downloadMisReport).toHaveBeenCalledOnce();
    });
  });

  it("shows a clear error when the export request fails", async () => {
    vi.mocked(downloadMisReport).mockRejectedValueOnce(new Error("Access denied"));
    render(<AnalyticsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Export Excel" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Excel export failed: Access denied",
    );
  });
});
