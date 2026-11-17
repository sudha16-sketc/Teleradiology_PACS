import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureError,
  redact,
  resetErrorReportingForTests,
  setRuntimeInfo,
  technicalDetails,
} from "./error-report";

afterEach(() => {
  resetErrorReportingForTests();
  vi.restoreAllMocks();
});

describe("desktop error reports", () => {
  it("keeps useful diagnostics while excluding PHI and credentials", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setRuntimeInfo({ appVersion: "1.2.3", os: "windows 11", environment: "staging" });
    const error = new Error(
      "Patient Jane Doe, MRN 12345678, token=super-secret\nPatient Jane Doe",
    );

    const report = captureError({
      error,
      failure: {
        kind: "server",
        message: "The PACS server ran into a problem.",
        status: 500,
        correlationId: "req-support-123",
        retryable: true,
        requiresSignIn: false,
      },
      referenceId: "support-ref",
      route: "/reading/1.2.840.10008.5.1.4.1.1.2",
      context: "react-boundary",
    });
    const logged = consoleError.mock.calls.map(([message]) => String(message)).join("\n");

    expect(report.referenceId).toBe("support-ref");
    expect(report.appVersion).toBe("1.2.3");
    expect(report.os).toBe("windows 11");
    expect(report.environment).toBe("staging");
    expect(report.errorType).toBe("Error");
    expect(report.message).toBe("server (HTTP 500)");
    expect(report.correlationId).toBe("req-support-123");
    expect(report.route).toBe("reading");
    expect(report.stack).toBeTruthy();
    expect(technicalDetails(report)).toContain("support-ref");
    expect(logged).toContain('"environment":"staging"');
    expect(logged).toContain('"stack":');
    expect(JSON.stringify(report)).not.toMatch(/Jane Doe|12345678|super-secret/);
    expect(logged).not.toMatch(/Jane Doe|12345678|super-secret/);
  });

  it("redacts numeric DICOM identifiers and long numbers", () => {
    expect(redact("study 1.2.840.10008.5.1.4 and accession 123456789"))
      .not.toMatch(/1\.2\.840|123456789/);
  });
});