export type ThemeMode = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "axis-theme";

export const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredTheme(): ThemeMode | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && isThemeMode(raw)) return raw;
  } catch {
    // localStorage unavailable (private mode / disabled): fall back to system
  }
  return null;
}

export function writeStoredTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors; theme still applies for the session
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode, systemDark = systemPrefersDark()): ResolvedTheme {
  if (mode === "system" || !isThemeMode(mode)) {
    return systemDark ? "dark" : "light";
  }
  return mode;
}

export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

/** Inline script injected into <head> before paint to avoid a flash of the
 *  wrong theme and to keep the first client render consistent. */
export function themeBootScript(): string {
  return [
    "(function(){",
    "try{",
    "var e=document.documentElement;",
    "var t=localStorage.getItem('" + THEME_STORAGE_KEY + "');",
    "var r;",
    "if(t==='light'||t==='dark'){r=t;}",
    "else{",
    "r=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';",
    "}",
    "e.setAttribute('data-theme',r);",
    "}catch(x){document.documentElement.setAttribute('data-theme','dark');}",
    "})();",
  ].join("");
}