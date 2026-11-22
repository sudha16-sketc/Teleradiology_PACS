import React, { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { READING_LAYOUT_STORAGE_KEY } from "@/lib/reading-layout";
import { ReadingPanels } from "./ReadingPanels";

const renderPanels = () =>
  render(
    <ReadingPanels
      viewer={<div>DICOM viewer content</div>}
      report={<div>Report content</div>}
      patient={<div>Patient content</div>}
    />,
  );

describe("ReadingPanels", () => {
  it("renders three accessible panels and two resizable separators", () => {
    renderPanels();

    expect(
      screen.getByRole("region", { name: "DICOM viewer panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Report panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Patient details panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("separator").map((element) =>
        element.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Resize DICOM viewer and report panels",
      "Resize report and patient details panels",
    ]);
  });

  it("keeps all mounted panel content when switching to a focus preset", async () => {
    const user = userEvent.setup();
    renderPanels();

    expect(screen.getByText("DICOM viewer content")).toBeInTheDocument();
    expect(screen.getByText("Report content")).toBeInTheDocument();
    expect(screen.getByText("Patient content")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Report focus" }));

    expect(screen.getByText("DICOM viewer content")).toBeInTheDocument();
    expect(screen.getByText("Patient content")).toBeInTheDocument();
    expect(screen.getByTestId("panel-frame-viewer")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("panel-frame-report")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
  });

  it("restores collapsed panels from the workspace toolbar", async () => {
    const user = userEvent.setup();
    renderPanels();

    await user.click(screen.getByRole("button", { name: "Patient focus" }));
    await user.click(screen.getByRole("button", { name: "Restore all" }));

    for (const name of [
      "DICOM viewer panel",
      "Report panel",
      "Patient details panel",
    ]) {
      expect(screen.getByRole("region", { name })).toHaveAttribute(
        "aria-hidden",
        "false",
      );
    }
  });

  it("supports keyboard resizing through the separator", async () => {
    renderPanels();
    const separator = screen.getByRole("separator", {
      name: "Resize DICOM viewer and report panels",
    });
    const before = Number(separator.getAttribute("aria-valuenow"));

    separator.focus();
    await waitFor(() => expect(separator).toHaveAttribute("aria-valuenow"));
    fireEvent.keyDown(separator, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(Number(separator.getAttribute("aria-valuenow"))).not.toBe(before);
    });
  });

  it("persists a versioned layout after resizing", async () => {
    const user = userEvent.setup();
    renderPanels();

    await user.click(screen.getByRole("button", { name: "Viewer + patient" }));

    await waitFor(() => {
      const stored = window.localStorage.getItem(READING_LAYOUT_STORAGE_KEY);
      expect(stored).toContain('"version":1');
      expect(stored).toContain('"preset":"viewerPatient"');
    });
  });

  it("does not remount panel content when layout changes", async () => {
    const user = userEvent.setup();
    let viewerMounts = 0;

    function StableViewer() {
      useEffect(() => {
        viewerMounts += 1;
      }, []);
      return <div>Stable viewer</div>;
    }

    render(
      <ReadingPanels
        viewer={<StableViewer />}
        report={<div>Report content</div>}
        patient={<div>Patient content</div>}
      />,
    );

    expect(viewerMounts).toBe(1);
    await user.click(screen.getByRole("button", { name: "Patient focus" }));
    await user.click(screen.getByRole("button", { name: "Balanced" }));
    expect(viewerMounts).toBe(1);
  });
});
