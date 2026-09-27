import { useEffect, useState } from "react";
import {
  applyTheme,
  getPalette,
  getThemeMode,
  themeBadge,
  type Palette,
  type ThemeMode,
  PALETTES,
  MODES,
} from "../lib/theme";

export function ThemeControl() {
  const [palette, setPalette] = useState<Palette>(() => getPalette());
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());

  useEffect(() => {
    applyTheme(palette, mode);
  }, [palette, mode]);

  return (
    <div className="theme-control" title={themeBadge(palette, mode)}>
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
      <select
        className="theme-btn"
        value={mode}
        onChange={(e) => setMode(e.target.value as ThemeMode)}
        aria-label="Color mode"
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <span className="theme-badge mono faint">{themeBadge(palette, mode)}</span>
    </div>
  );
}
