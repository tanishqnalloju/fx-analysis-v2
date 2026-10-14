export type Pt = { t: string; v: number };

function sd(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Session Δ% z-score vs pair's own realized daily vol (stored history, excluding the session itself). */
export function unusualToday(fx: any[], series: Record<string, Pt[]> | undefined, n = 5) {
  const out: Array<{ pair: string; chg: number; z: number; vol: number; obs: number }> = [];
  for (const r of fx || []) {
    const s = series?.[r.pair];
    if (!s || s.length < 21 || r.changePct == null || !Number.isFinite(r.changePct)) continue;
    const rets: number[] = [];
    for (let i = 1; i < s.length - 1; i++) rets.push((s[i].v / s[i - 1].v - 1) * 100);
    const vol = sd(rets);
    if (!(vol > 0)) continue;
    out.push({ pair: r.pair, chg: r.changePct, z: r.changePct / vol, vol, obs: rets.length });
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, n);
}

const pos = (vals: number[], n: number) => {
  if (vals.length < n) return null;
  const w = vals.slice(-n);
  const lo = Math.min(...w), hi = Math.max(...w), last = w[w.length - 1];
  return hi === lo ? 50 : ((last - lo) / (hi - lo)) * 100;
};
const sma = (vals: number[], n: number) =>
  vals.length < n ? null : vals.slice(-n).reduce((a, b) => a + b, 0) / n;

export function rangeContext(s: Pt[] | undefined) {
  if (!s || s.length < 15) return null;
  const v = s.map((p) => p.v);
  const last = v[v.length - 1];
  const d = v.slice(-15).slice(1).map((x, i) => Math.abs(x - v.slice(-15)[i]));
  const atr = d.reduce((a, b) => a + b, 0) / d.length;
  const y = v.slice(-252);
  const hi = Math.max(...y), lo = Math.min(...y);
  const s50 = sma(v, 50), s200 = sma(v, 200);
  const pctTo = (ref: number | null) => (ref == null ? null : (last / ref - 1) * 100);
  return {
    last, asOf: s[s.length - 1].t, atr, atrPct: (atr / last) * 100,
    p20: pos(v, 20), p60: pos(v, 60), p250: pos(v, 250),
    toHi: pctTo(hi), toLo: pctTo(lo), yObs: y.length,
    toS50: pctTo(s50), toS200: pctTo(s200),
  };
}
