import { useEffect, useState } from "react";
import {
  applyTheme,
  getPalette,
  getThemeMode,
  resolveMode,
  type Palette,
  type ThemeMode,
  PALETTES,
} from "../lib/theme";

/** Cycle: dark → light → system → dark */
function nextMode(current: ThemeMode): ThemeMode {
  if (current === "dark") return "light";
  if (current === "light") return "system";
  return "dark";
}

function toggleLabel(mode: ThemeMode): string {
  if (mode === "system") return "System";
  return resolveMode(mode) === "dark" ? "Dark" : "Light";
}

export function ThemeControl() {
  const [palette, setPalette] = useState<Palette>(() => getPalette());
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());

  useEffect(() => {
    applyTheme(palette, mode);
  }, [palette, mode]);

  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme(palette, "system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, palette]);

  return (
    <div className="theme-control">
      <label className="sr-only" htmlFor="palette-select">
        Palette
      </label>
      <select
        id="palette-select"
        className="theme-btn"
        value={palette}
        onChange={(e) => setPalette(e.target.value as Palette)}
        aria-label="Color palette"
      >
        {PALETTES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="theme-btn theme-toggle"
        onClick={() => setMode(nextMode(mode))}
        aria-label={`Color mode ${mode}. Click to change.`}
        title="Dark → Light → System"
      >
        {toggleLabel(mode)}
      </button>
    </div>
  );
}
