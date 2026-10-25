// Pure helpers for the /reserves page. No interpolation anywhere: a value that is not in the
// source series at (or within a small gap before) the requested date comes back as null.
import { mean, sd, type P } from "./histstats";

export type Week = { date: string; pub: string; src: string; total: number; fca: number; gold: number; sdr: number; imf: number; totalInrCr: number; wow: number | null; wowFca: number | null; wowGold: number | null };
export type Iv = { month: string; purchase: number; sale: number; net: number; fwd: number | null; src: string; srcLabel: string };
export type Ne = { month: string; neer6?: number; reer6?: number; neer40?: number; reer40?: number; neer6_0405?: number; reer6_0405?: number; src?: string; src40?: string };
export type Debt = { quarter: string; label: string; release: string; src: string; total: number; shares: Record<string, number>; stPctTotal: number | null; stPctReserves: number | null; stUsdBn: number | null; dsr: number | null; valuation: string | null };
export type Trade = { month: string; imports: number; exports: number | null; src: string; srcLabel: string };
export type Section<T> = { title: string; unit?: string; frequency?: string; source: string; sourceUrl: string; retrieved: string; caveat?: string; rows: T[] };
export type ReservesData = {
  generated: string; script: string; notes: string[];
  weekly: Section<Week>; intervention: Section<Iv> & { mean: number; sd: number }; neer: Section<Ne>;
  debt: Section<Debt>; debtAnnual: Section<{ year: number; total: number; debtGdp: number; dsr: number; resToDebt: number; concPct: number; stToRes: number; stPct: number }>;
  trade: Section<Trade>; events: { retrieved: string; rows: RawEvent[] };
};
export type RawEvent = { date: string; kind: string; title: string; text: string; src: string; srcLabel: string };
export type Kind = "sale" | "purchase" | "drop" | "record" | "mpc" | "fomc";
export type Ev = RawEvent & { id: string; kind: Kind; monthly?: string; ivNet?: number; amountLabel?: string };

export const DAY = 864e5;
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
export const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
export const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monLabel = (m: string) => `${MONS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
export const dayLabel = (d: string) => `${+d.slice(8, 10)} ${MONS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

/** last observation on/before `d`, only if it is at most `maxGap` days old and `d` is not past the series end. */
export function at(s: P[], d: string, maxGap: number): { t: string; v: number } | null {
  if (!s.length || d > s[s.length - 1].t || d < s[0].t) return null;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].t <= d) lo = mid; else hi = mid - 1; }
  const p = s[lo];
  return (Date.parse(d) - Date.parse(p.t)) / DAY <= maxGap ? p : null;
}

export function median(a: number[]) { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; }
export function corr(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length); if (n < 3) return NaN;
  const mx = mean(x), my = mean(y); let c = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { c += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
  return c / Math.sqrt(vx * vy);
}
/** OLS slope y = a + b x */
export function slope(x: number[], y: number[]) { const mx = mean(x), my = mean(y); let c = 0, v = 0; x.forEach((xi, i) => { c += (xi - mx) * (y[i] - my); v += (xi - mx) ** 2; }); return c / v; }

/** rolling annualized realized vol of daily % changes (√252), window n. */
export function rollVolPts(s: P[], n: number): P[] {
  const r: { t: string; r: number }[] = [];
  for (let i = 1; i < s.length; i++) r.push({ t: s[i].t, r: (s[i].v / s[i - 1].v - 1) * 100 });
  const o: P[] = [];
  for (let i = n - 1; i < r.length; i++) o.push({ t: r[i].t, v: sd(r.slice(i - n + 1, i + 1).map((x) => x.r)) * Math.sqrt(252) });
  return o;
}
/** last obs per calendar month */
export function monthLast(s: P[]): Map<string, P> { const m = new Map<string, P>(); s.forEach((p) => m.set(p.t.slice(0, 7), p)); return m; }
/** mean of obs per calendar month */
export function monthAvg(s: P[]): Map<string, number> {
  const acc = new Map<string, [number, number]>();
  s.forEach((p) => { const k = p.t.slice(0, 7); const a = acc.get(k) || [0, 0]; a[0] += p.v; a[1]++; acc.set(k, a); });
  return new Map([...acc].map(([k, [s1, n]]) => [k, s1 / n]));
}
/** month-on-month % change of a monthly map, only where both months exist and are consecutive */
export function momPct(m: Map<string, number>): Map<string, number> {
  const o = new Map<string, number>();
  for (const [k, v] of m) { const pv = m.get(prevMonth(k)); if (pv != null) o.set(k, (v / pv - 1) * 100); }
  return o;
}
export function rollStd(keys: string[], m: Map<string, number>, n: number): P[] {
  const o: P[] = [];
  for (let i = n - 1; i < keys.length; i++) {
    const w = keys.slice(i - n + 1, i + 1).map((k) => m.get(k));
    if (w.every((x) => x != null)) o.push({ t: keys[i] + "-01", v: sd(w as number[]) });
  }
  return o;
}

export function fmt(v: number | null | undefined, d = 1) { return v == null || !Number.isFinite(v) ? "n/a" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }); }
export function sg(v: number | null | undefined, d = 1) { return v == null || !Number.isFinite(v) ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`; }

export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][], foot: string[]) {
  const esc = (x: string | number | null | undefined) => { const s = x == null ? "" : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = [header.join(","), ...rows.map((r) => r.map(esc).join(",")), ...foot.map((f) => "# " + f)].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" })); a.download = name; a.click();
}
