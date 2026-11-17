import { describe, expect, it } from "vitest";

import {
  classifyStatus,
  classifyThrown,
  failureHint,
  isConnectivityFailure,
} from "./api-error";
import { failureOf } from "./api-client";

describe("API failure handling", () => {
  it("distinguishes unavailable PACS, timeout, authentication, and Orthanc", () => {
    const offline = classifyThrown(new TypeError("fetch failed"), "req-offline");
    const timeout = classifyThrown({ name: "TimeoutError" }, "req-timeout");
    const auth = classifyStatus(401, undefined, "req-auth");
    const imaging = classifyStatus(503, "upstream detail", "req-image");

    expect(offline.message).toBe("Unable to connect to PACS server.");
    expect(offline.correlationId).toBe("req-offline");
    expect(timeout.kind).toBe("timeout");
    expect(auth.requiresSignIn).toBe(true);
    expect(imaging.message).not.toContain("upstream detail");
    expect(isConnectivityFailure(offline)).toBe(true);
    expect(failureHint(offline)).toContain("does not work offline");
  });

  it("does not mislabel ordinary application errors as a connection outage", () => {
    expect(failureOf(new TypeError("render failed"))).toEqual({
      kind: "unknown",
      message: "Something went wrong.",
      retryable: false,
      requiresSignIn: false,
    });
  });
});