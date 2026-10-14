export type P = { t: string; v: number };
export const rets = (s: P[]) => s.slice(1).map((p, i) => ({ t: p.t, r: (p.v / s[i].v - 1) * 100 }));
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const sd = (a: number[]) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : NaN; };
export function sma(s: P[], n: number): P[] {
  const o: P[] = []; let sum = 0;
  s.forEach((p, i) => { sum += p.v; if (i >= n) sum -= s[i - n].v; if (i >= n - 1) o.push({ t: p.t, v: sum / n }); });
  return o;
}
export function rollVol(s: P[], n = 20): P[] {
  const r = rets(s); const o: P[] = [];
  for (let i = n - 1; i < r.length; i++) o.push({ t: r[i].t, v: sd(r.slice(i - n + 1, i + 1).map((x) => x.r)) * Math.sqrt(252) });
  return o;
}
export function drawdown(s: P[]) {
  let pk = -Infinity, pkT = "", worst = 0, worstT = "", worstPk = "";
  const o = s.map((p) => { if (p.v > pk) { pk = p.v; pkT = p.t; } const d = (p.v / pk - 1) * 100; if (d < worst) { worst = d; worstT = p.t; worstPk = pkT; } return { t: p.t, v: d }; });
  return { series: o, max: worst, troughT: worstT, peakT: worstPk };
}
export function rollCorr(a: P[], b: P[], n = 60): P[] {
  const bm = new Map(b.map((p) => [p.t, p.v]));
  const j = a.filter((p) => bm.has(p.t));
  const ra = rets(j), rb = rets(j.map((p) => ({ t: p.t, v: bm.get(p.t)! })));
  const o: P[] = [];
  for (let i = n - 1; i < ra.length; i++) {
    const x = ra.slice(i - n + 1, i + 1).map((q) => q.r), y = rb.slice(i - n + 1, i + 1).map((q) => q.r);
    const mx = mean(x), my = mean(y); let c = 0, vx = 0, vy = 0;
    for (let k = 0; k < n; k++) { c += (x[k] - mx) * (y[k] - my); vx += (x[k] - mx) ** 2; vy += (y[k] - my) ** 2; }
    o.push({ t: ra[i].t, v: c / Math.sqrt(vx * vy) });
  }
  return o;
}
/** month-end to month-end returns: { "2024": { 0: pct, ... } } using last obs of each month */
export function monthly(s: P[]) {
  const last = new Map<string, number>();
  s.forEach((p) => last.set(p.t.slice(0, 7), p.v));
  const keys = [...last.keys()]; const o: Record<string, Record<number, number>> = {};
  for (let i = 1; i < keys.length; i++) { const [y, m] = keys[i].split("-"); (o[y] ||= {})[+m - 1] = (last.get(keys[i])! / last.get(keys[i - 1])! - 1) * 100; }
  return o;
}
export function dow(s: P[]) {
  const b: number[][] = [[], [], [], [], []];
  rets(s).forEach((x) => { const d = new Date(x.t + "T00:00:00Z").getUTCDay(); if (d >= 1 && d <= 5) b[d - 1].push(x.r); });
  return b.map((a) => ({ avg: mean(a), n: a.length }));
}
