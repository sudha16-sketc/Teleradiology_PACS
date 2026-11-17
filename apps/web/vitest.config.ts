import { defineConfig } from "vitest/config";

/**
 * Unit tests run in a plain Node environment: the platform layer is the piece
 * that must behave identically on the server, in a browser tab and inside the
 * Tauri webview, so it deliberately avoids any DOM dependency and only touches
 * `globalThis` / `process.env`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The web app is not unit tested with a browser harness yet; the frontend
    // contract worth pinning down is the platform abstraction, which needs none.
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
    },
  },
});
