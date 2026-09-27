import { chgTone, formatPct, strengthTone } from "../lib/format";

export function FxPct({ value }: { value: number | null | undefined }) {
  const t = chgTone(value);
  const cls = t === "weaker" ? "coral" : t === "stronger" ? "teal" : "faint";
  return <span className={`mono ${cls}`}>{formatPct(value)}</span>;
}

export function StrengthPct({ value }: { value: number | null | undefined }) {
  const t = strengthTone(value);
  const cls = t === "up" ? "teal" : t === "down" ? "coral" : "faint";
  return <span className={`mono ${cls}`}>{formatPct(value)}</span>;
}
