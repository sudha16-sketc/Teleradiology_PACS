"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store";
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  writeStoredTheme,
} from "@/lib/theme";

/**
 * Client-side theme manager. Owns every side effect of the theme selection:
 *  - hydrates the persisted preference (localStorage `axis-theme`) once on
 *    mount so refresh/browser-restart keeps the choice;
 *  - applies the resolved `data-theme` attribute to <html> whenever the mode
 *    or the OS preference changes;
 *  - persists the explicit choice so logout/login does not reset it.
 *
 * No HTML attribute is rendered on the server, so there is no hydration
 * mismatch; the pre-paint inline script in layout.tsx already sets the
 * attribute to avoid any flash of the wrong theme.
 */
export function ThemeManager({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  // Hydrate persisted preference once on mount (mirrors the boot script).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = readStoredTheme();
    if (stored) {
      setTheme(stored);
    }
  }, [setTheme]);

  // Apply + persist whenever the selected mode changes.
  useEffect(() => {
    applyTheme(resolveTheme(theme, systemPrefersDark()));
    writeStoredTheme(theme);
  }, [theme]);

  // Follow OS preference changes while in "system" mode.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(resolveTheme("system", mq.matches));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return <>{children}</>;
}