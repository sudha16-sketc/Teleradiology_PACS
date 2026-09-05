import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", "[data-theme='dark']"],
  theme: {
    fontFamily: {
      sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
      heading: [
        "var(--font-heading)",
        "var(--font-sans)",
        "system-ui",
        "sans-serif",
      ],
      mono: ["var(--font-mono)", "Fira Code", "monospace"],
      serif: ["var(--font-serif)", "Georgia", "serif"],
    },
    colors: {
      background: "var(--color-background)",
      surface: {
        DEFAULT: "var(--color-surface)",
        raised: "var(--color-surface-raised)",
      },
      border: "var(--color-border)",
      text: {
        primary: "var(--color-text-primary)",
        muted: "var(--color-text-muted)",
      },
      accent: "var(--color-accent)",
      warning: "var(--color-warning)",
      success: "var(--color-success)",
      error: "var(--color-error)",
      paper: "var(--color-paper)",
      editor: "var(--color-editor)",
      "editor-ink": "var(--color-editor-ink)",
      muted: "var(--color-text-muted)",
    },
    borderRadius: {
      none: "0",
      sm: "3px",
      DEFAULT: "4px",
      md: "6px",
      lg: "6px",
      full: "9999px",
    },
    extend: {},
  },
  plugins: [],
};

export default config;
