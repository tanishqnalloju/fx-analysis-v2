export function formatInr(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  if (opts.compact !== false && abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (opts.compact !== false && abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return (
    "₹" +
    v.toLocaleString("en-IN", {
      maximumFractionDigits: abs >= 100 ? 2 : abs >= 1 ? 4 : 6,
      minimumFractionDigits: 0,
    })
  );
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function formatRate(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return v.toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(2, digits),
  });
}

/** FX level Δ%: up = weaker INR (coral), down = stronger (teal). */
export function chgTone(n: number | null | undefined): "weaker" | "stronger" | "flat" {
  if (n == null || !Number.isFinite(Number(n))) return "flat";
  const v = Number(n);
  if (v > 0) return "weaker";
  if (v < 0) return "stronger";
  return "flat";
}

/** Relative strength / slip: up = strengthened (teal). */
export function strengthTone(n: number | null | undefined): "up" | "down" | "flat" {
  if (n == null || !Number.isFinite(Number(n))) return "flat";
  const v = Number(n);
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "flat";
}

export function asOfDate(snap: { asOf?: string } | null | undefined): string {
  return (snap?.asOf || "").slice(0, 10) || "—";
}

export function findFx(fx: any[] | undefined, pair: string) {
  return (fx || []).find((r) => String(r.pair || "").toUpperCase() === pair) || null;
}

export function findHard(hard: any[] | undefined, id: string) {
  const want = String(id).toUpperCase();
  return (hard || []).find((r) => String(r.id || "").toUpperCase() === want) || null;
}
