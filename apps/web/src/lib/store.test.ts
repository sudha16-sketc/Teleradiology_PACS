import { beforeEach, describe, expect, it, vi } from "vitest";

const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiClient: apiClientMock }));

import { resetAuthHydrationForTests, useAppStore } from "./store";

beforeEach(() => {
  resetAuthHydrationForTests();
  apiClientMock.get.mockReset();
  useAppStore.setState({ currentUser: null, authStatus: "loading" });
});

describe("auth hydration", () => {
  it("shares one /auth/me request between concurrent callers", async () => {
    let resolveRequest!: (value: unknown) => void;
    apiClientMock.get.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const hydrateAuth = useAppStore.getState().hydrateAuth;
    const first = hydrateAuth();
    const second = hydrateAuth();

    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    expect(apiClientMock.get).toHaveBeenCalledWith("/auth/me");

    resolveRequest({
      data: {
        id: "user-1",
        email: "user@example.test",
        displayName: "Test User",
        role: "RADIOLOGIST",
      },
    });
    await Promise.all([first, second]);

    expect(useAppStore.getState().authStatus).toBe("authenticated");
    expect(useAppStore.getState().currentUser?.id).toBe("user-1");
  });

  it("allows a fresh request after the shared hydration settles", async () => {
    apiClientMock.get.mockRejectedValue(new Error("Unauthorized"));

    await useAppStore.getState().hydrateAuth();
    await useAppStore.getState().hydrateAuth();

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().authStatus).toBe("anonymous");
  });
});
