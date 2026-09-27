export type Palette = "graphite" | "slate" | "warm" | "nord";
/** Stored preference — system follows OS prefers-color-scheme */
export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const PALETTE_KEY = "fxv2-palette";
const THEME_KEY = "fxv2-theme";

export const PALETTES: Palette[] = ["graphite", "slate", "warm", "nord"];
export const MODES: ThemeMode[] = ["dark", "light", "system"];

export function getPalette(): Palette {
  try {
    const v = localStorage.getItem(PALETTE_KEY) as Palette | null;
    if (v && PALETTES.includes(v)) return v;
  } catch {}
  return "graphite";
}

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    if (v && MODES.includes(v)) return v;
  } catch {}
  return "dark";
}

export function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
}

export function applyTheme(palette: Palette, mode: ThemeMode) {
  const resolved = resolveMode(mode);
  document.documentElement.setAttribute("data-palette", palette);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-pref", mode);
  try {
    localStorage.setItem(PALETTE_KEY, palette);
    localStorage.setItem(THEME_KEY, mode);
  } catch {}
}


