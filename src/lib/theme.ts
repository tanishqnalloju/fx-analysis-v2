export type Palette = "graphite" | "slate" | "warm" | "nord";
export type ThemeMode = "dark" | "light";

const PALETTE_KEY = "fxv2-palette";
const THEME_KEY = "fxv2-theme";

export const PALETTES: Palette[] = ["graphite", "slate", "warm", "nord"];
export const MODES: ThemeMode[] = ["dark", "light"];

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

export function applyTheme(palette: Palette, mode: ThemeMode) {
  document.documentElement.setAttribute("data-palette", palette);
  document.documentElement.setAttribute("data-theme", mode);
  try {
    localStorage.setItem(PALETTE_KEY, palette);
    localStorage.setItem(THEME_KEY, mode);
  } catch {}
}

export function themeBadge(palette: Palette, mode: ThemeMode) {
  return `THEME · ${palette.toUpperCase()} · ${mode.toUpperCase()}`;
}
