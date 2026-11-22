import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [
      "src/lib/report-access.test.ts",
      "**/node_modules/**",
      "**/dist/**",
    ],
    setupFiles: ["src/test/setup.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
    },
  },
});
