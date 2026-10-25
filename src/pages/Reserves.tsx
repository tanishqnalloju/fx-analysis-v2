import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE } from "react";
import { useSearchParams } from "react-router-dom";
import { createChart, type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type SeriesType } from "lightweight-charts";
import { mean, sd, type P } from "../lib/histstats";
import {
  addDays, at, corr, dayLabel, downloadCsv, fmt, median, monLabel, monthAvg, monthEnd, monthLast, momPct, prevMonth, rollStd, rollVolPts, sg, slope,
  type Debt, type Ev, type Kind, type ReservesData,
} from "../lib/reserves";

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
function useThemeKey() {
  const [k, setK] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setK((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => mo.disconnect();
  }, []);
  return k;
}
const RANGES: Record<string, number> = { "1Y": 365, "3Y": 1096, "5Y": 1827, Max: 1e6 };
const PEERS = ["CNY", "IDR", "KRW", "THB", "PHP", "MYR", "BRL", "ZAR", "MXN"];
const KINDS: { k: Kind; label: string; short: string }[] = [
  { k: "sale", label: "Large RBI net sale (month)", short: "S" },
  { k: "purchase", label: "Large RBI net purchase (month)", short: "P" },
  { k: "drop", label: "Large weekly reserve drop", short: "R" },
  { k: "record", label: "USDINR new series high", short: "H" },
  { k: "mpc", label: "RBI MPC decision", short: "M" },
  { k: "fomc", label: "FOMC decision day", short: "F" },
];
const kindColor = (k: Kind) => ({ sale: css("--warn"), purchase: css("--accent"), drop: css("--warn"), record: css("--vsinr-up"), mpc: css("--muted"), fomc: css("--faint") }[k]);
const vsTone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005 ? "" : v > 0 ? "vs-up" : "vs-down");

type Hist = { source: string; sourceUrl: string; from: string; to: string; points: [string, number][] };
type EmFx = { source: string; sourceUrl: string; from: string; to: string; codes: string[]; rows: (string | number | null)[][] };
type SeriesSpec = { kind: "line" | "hist"; data: { t: string; v: number; color?: string }[]; color: string; title?: string; width?: number; scale?: "left" | "right"; dashed?: boolean };

const timeStr = (t: Time): string => (typeof t === "string" ? t : typeof t === "number" ? new Date(t * 1000).toISOString().slice(0, 10) : `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`);

/** lightweight-charts wrapper: series built once per data/theme change; markers and focus updated separately so zoom is kept. */
function EvChart({ series, markers, height = 260, themeKey, onPick, focus, label, onKey }: {
  series: SeriesSpec[]; markers?: SeriesMarker<Time>[]; height?: number; themeKey: number; onPick?: (t: string, tolDays: number) => void; focus?: string | null; label: string; onKey?: (e: RKE<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const first = useRef<ISeriesApi<SeriesType> | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  useEffect(() => {
    if (!ref.current) return;
    const ch = createChart(ref.current, {
      height, autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--mono") },
      grid: { vertLines: { color: css("--hairline") }, horzLines: { color: css("--hairline") } },
      rightPriceScale: { borderColor: css("--border") }, leftPriceScale: { borderColor: css("--border"), visible: series.some((s) => s.scale === "left") },
      timeScale: { borderColor: css("--border") }, crosshair: { mode: 0 },
    });
    series.forEach((s, i) => {
      const api = s.kind === "hist"
        ? ch.addHistogramSeries({ color: s.color, priceScaleId: s.scale || "right", priceLineVisible: false, title: s.title })
        : ch.addLineSeries({ color: s.color, lineWidth: (s.width || 1) as 1, title: s.title, priceScaleId: s.scale || "right", priceLineVisible: false, lineStyle: s.dashed ? 2 : 0 });
      api.setData(s.data.map((p) => (s.kind === "hist" ? { time: p.t as Time, value: p.v, color: p.color } : { time: p.t as Time, value: p.v })) as any);
      if (i === 0) first.current = api;
    });
    ch.timeScale().fitContent();
    ch.subscribeClick((p) => {
      if (!p.time || !pick.current) return;
      const vr = ch.timeScale().getVisibleRange(), w = ref.current?.clientWidth || 800;
      const dpp = vr ? (Date.parse(timeStr(vr.to)) - Date.parse(timeStr(vr.from))) / 864e5 / w : 1;
      pick.current(timeStr(p.time), dpp * 10); // ~10px hit radius, like clicking a TradingView marker
    });
    chart.current = ch;
    return () => { ch.remove(); chart.current = null; first.current = null; };
  }, [series, height, themeKey]);
  useEffect(() => { first.current?.setMarkers(markers || []); }, [markers, series, themeKey]);
  useEffect(() => {
    const ch = chart.current; if (!ch || !focus) return;
    const vr = ch.timeScale().getVisibleRange();
    if (vr && focus >= timeStr(vr.from) && focus <= timeStr(vr.to)) return;
    const s0 = series[0]?.data; if (!s0?.length) return;
    const span = Math.max(30, (Date.parse(s0[s0.length - 1].t) - Date.parse(s0[0].t)) / 864e5 / 6);
    const a = addDays(focus, -span), b = addDays(focus, span);
    try { ch.timeScale().setVisibleRange({ from: (a < s0[0].t ? s0[0].t : a) as Time, to: (b > s0[s0.length - 1].t ? s0[s0.length - 1].t : b) as Time }); } catch { /* range outside data */ }
  }, [focus, series]);
  return <div ref={ref} className="lw" style={{ height }} tabIndex={0} role="application" aria-label={label} onKeyDown={onKey} />;
}

function Scatter({ pts, xLabel, yLabel, colorOf }: { pts: { x: number; y: number; k: string }[]; xLabel: string; yLabel: string; colorOf: (p: { x: number; y: number }) => string }) {
  if (pts.length < 3) return <div className="mono faint pad">— not enough overlapping months</div>;
  const W = 520, H = 260, m = 34;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const xm = Math.max(...xs.map(Math.abs)) * 1.1 || 1, ym = Math.max(...ys.map(Math.abs)) * 1.1 || 1;
  const X = (v: number) => m + ((v + xm) / (2 * xm)) * (W - 2 * m), Y = (v: number) => H - m - ((v + ym) / (2 * ym)) * (H - 2 * m);
  const b = slope(xs, ys), a = mean(ys) - b * mean(xs);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sc-svg" role="img" aria-label={`Scatter of ${yLabel} against ${xLabel}, ${pts.length} months`}>
      <line x1={X(-xm)} x2={X(xm)} y1={Y(0)} y2={Y(0)} className="ax" /><line x1={X(0)} x2={X(0)} y1={Y(-ym)} y2={Y(ym)} className="ax" />
      <line x1={X(-xm)} x2={X(xm)} y1={Y(a + b * -xm)} y2={Y(a + b * xm)} className="fit" />
      {pts.map((p) => <circle key={p.k} cx={X(p.x)} cy={Y(p.y)} r={3} fill={colorOf(p)} opacity={0.8}><title>{`${p.k}: x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)}`}</title></circle>)}
      <text x={W - m} y={Y(0) - 4} textAnchor="end" className="axt">{xLabel} →</text>
      <text x={X(0) + 4} y={m - 8} className="axt">↑ {yLabel}</text>
      <text x={X(-xm) + 2} y={Y(-ym) + 14} className="axt">{(-xm).toFixed(1)}</text><text x={X(xm) - 2} y={Y(-ym) + 14} textAnchor="end" className="axt">{xm.toFixed(1)}</text>
      <text x={X(0) - 4} y={Y(ym) + 10} textAnchor="end" className="axt">{ym.toFixed(1)}</text><text x={X(0) - 4} y={Y(-ym)} textAnchor="end" className="axt">{(-ym).toFixed(1)}</text>
    </svg>
  );
}

function Src({ s, extra }: { s: { source: string; sourceUrl: string; frequency?: string; retrieved: string }; extra?: string }) {
  return <span className="meta">Source: <a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.source}</a>{s.frequency ? ` · ${s.frequency}` : ""}{extra ? ` · ${extra}` : ""} · retrieved {s.retrieved}</span>;
}

export function Reserves() {
  const [sp, setSp] = useSearchParams();
  const themeKey = useThemeKey();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); v == null || v === "" ? n.delete(k) : n.set(k, v); setSp(n, { replace: true }); };
  const range = sp.get("range") || "Max";
  const flag = sp.get("flag") || "2s";
  const kindsOn = new Set((sp.get("kinds") ?? "sale,purchase,drop,record").split(",").filter(Boolean) as Kind[]);
  const selId = sp.get("ev");

  const [d, setD] = useState<ReservesData | null>(null);
  const [usd, setUsd] = useState<Hist | null>(null);
  const [em, setEm] = useState<EmFx | null>(null);
  const [err, setErr] = useState<string[]>([]);
  useEffect(() => {
    fetch("/data/reserves.json").then((r) => r.json()).then(setD).catch((e) => setErr((x) => [...x, "reserves.json: " + e]));
    fetch("/api/pairhistory?code=USD").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setUsd(j); }).catch((e) => setErr((x) => [...x, "USDINR history (Frankfurter/ECB): " + e.message]));
    fetch("/api/emfx").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setEm(j); }).catch((e) => setErr((x) => [...x, "peer FX (Frankfurter/ECB): " + e.message]));
  }, []);

  // ---------- base series
  const U: P[] = useMemo(() => (usd?.points || []).map(([t, v]) => ({ t, v })), [usd]);
  const emS = useMemo(() => {
    const o: Record<string, P[]> = {};
    if (!em) return o;
    em.codes.forEach((c, j) => { o[c] = em.rows.filter((r) => r[j + 1] != null).map((r) => ({ t: r[0] as string, v: r[j + 1] as number })); });
    return o;
  }, [em]);
  const W = d?.weekly.rows || [];
  const Wt: P[] = useMemo(() => W.map((w) => ({ t: w.date, v: w.total / 1000 })), [d]);
  const lastT = [U.at(-1)?.t, W.at(-1)?.date].filter(Boolean).sort().at(-1) || "";
  const from = range === "Max" ? "2018-12-01" : lastT ? addDays(lastT, -(RANGES[range] ?? 1e6)) : "";
  const inR = (t: string) => t >= from;
  const pinDefault = d?.debt.rows.at(-1)?.quarter || "";
  const pin = sp.get("pin") || pinDefault;

  // ---------- intervention flags
  const ivRows = d?.intervention.rows || [];
  const ivMu = d?.intervention.mean ?? 0, ivSd = d?.intervention.sd ?? 1;
  const thr = flag === "2s" ? null : Number(flag) * 1000;
  const isFlag = (net: number) => (thr == null ? Math.abs(net - ivMu) > 2 * ivSd : Math.abs(net) >= thr);
  const flagRule = thr == null ? `|net − mean| > 2σ (mean ${fmt(ivMu / 1000, 2)} bn, σ ${fmt(ivSd / 1000, 2)} bn over ${ivRows[0] ? monLabel(ivRows[0].month) : ""}–${ivRows.at(-1) ? monLabel(ivRows.at(-1)!.month) : ""})` : `|net| ≥ US$ ${flag} bn`;

  // ---------- events
  const events: Ev[] = useMemo(() => {
    if (!d) return [];
    const ev: Ev[] = [];
    for (const r of ivRows) if (isFlag(r.net)) {
      const z = (r.net - ivMu) / ivSd;
      ev.push({ id: `iv-${r.month}`, date: monthEnd(r.month), kind: r.net < 0 ? "sale" : "purchase", monthly: r.month, ivNet: r.net,
        title: `RBI net ${r.net < 0 ? "sale" : "purchase"} of US$ ${fmt(Math.abs(r.net) / 1000, 2)} bn in ${monLabel(r.month)}`,
        text: `RBI's OTC operations in ${monLabel(r.month)}: purchases US$ ${fmt(r.purchase / 1000, 2)} bn, sales US$ ${fmt(r.sale / 1000, 2)} bn, net ${sg(r.net / 1000, 2)} bn (${sg(z, 1)}σ vs the sample mean).`,
        src: r.src, srcLabel: r.srcLabel });
    }
    const wows = W.map((w) => w.wow).filter((x): x is number => x != null);
    const wm = mean(wows), ws = sd(wows);
    for (const w of W) if (w.wow != null && w.wow < wm - 2 * ws)
      ev.push({ id: `wk-${w.date}`, date: w.date, kind: "drop", title: `Reserves fell US$ ${fmt(-w.wow / 1000, 2)} bn in the week to ${dayLabel(w.date)}`,
        text: `RBI's weekly statistical supplement shows total reserves down US$ ${fmt(-w.wow / 1000, 2)} bn (FCA ${sg((w.wowFca ?? NaN) / 1000, 2)} bn, gold ${sg((w.wowGold ?? NaN) / 1000, 2)} bn) to US$ ${fmt(w.total / 1000, 1)} bn. Weekly changes include valuation effects, so this is not the same as FX sales.`,
        src: w.src, srcLabel: "RBI Weekly Statistical Supplement, Table 2" });
    if (U.length && usd) {
      let mx = -Infinity; const seen = new Set<string>();
      for (const p of U) {
        if (p.v > mx) {
          mx = p.v;
          if (p.t >= "2019-01-01" && !seen.has(p.t.slice(0, 7))) {
            seen.add(p.t.slice(0, 7));
            ev.push({ id: `rec-${p.t}`, date: p.t, kind: "record", title: `USDINR new high in this dataset: ${p.v.toFixed(4)}`,
              text: `The ECB reference USDINR rate reached ${p.v.toFixed(4)}, the highest in this daily series (which starts ${usd.from}); in other words a new low for INR against USD in this dataset. First such day in ${monLabel(p.t.slice(0, 7))}.`,
              src: usd.sourceUrl, srcLabel: usd.source });
          }
        }
      }
    }
    let prevRate: number | null = null;
    for (const r of [...d.events.rows].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (r.kind === "mpc") {
        const m = /([0-9]+\.[0-9]+)%/.exec(r.text); const rate = m ? Number(m[1]) : null;
        let title = r.title, text = r.text;
        if (rate != null) {
          const bp = prevRate != null ? Math.round((rate - prevRate) * 100) : null;
          const act = bp == null ? "set" : bp > 0 ? `raised (+${bp} bp)` : bp < 0 ? `cut (${bp} bp)` : "held";
          title = `RBI MPC: repo rate ${bp == null ? "at" : bp === 0 ? "held at" : act.split(" ")[0] + " to"} ${rate.toFixed(2)}%`;
          text = `RBI's Monetary Policy Committee ${act === "held" ? "kept" : act} the policy repo rate ${act === "held" ? "at" : "to"} ${rate.toFixed(2)}%${prevRate != null ? ` (previous decision in this list: ${prevRate.toFixed(2)}%)` : ""}.`;
          prevRate = rate;
        }
        ev.push({ ...r, title, text, id: `${r.kind}-${r.date}`, kind: "mpc" });
      } else ev.push({ ...r, id: `${r.kind}-${r.date}`, kind: r.kind as Kind });
    }
    return ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind < b.kind ? -1 : 1));
  }, [d, U, usd, flag]);
  const shown = useMemo(() => events.filter((e) => kindsOn.has(e.kind) && inR(e.date)), [events, sp.toString(), from]);
  const sel = events.find((e) => e.id === selId) || null;
  const select = (e: Ev | null) => set("ev", e ? e.id : null);

  // ---------- effect windows
  const effect = (e: Ev) => {
    const wins = e.monthly
      ? [{ l: "within month", a: monthEnd(prevMonth(e.monthly)), b: e.date }, { l: "+1m after", a: e.date, b: addDays(e.date, 30) }]
      : [{ l: "−1w", a: addDays(e.date, -7), b: e.date }, { l: "+1w", a: e.date, b: addDays(e.date, 7) }, { l: "+1m", a: e.date, b: addDays(e.date, 30) }];
    return wins.map((w) => {
      const ra = at(Wt, w.a, 7), rb = at(Wt, w.b, 7), ua = at(U, w.a, 5), ub = at(U, w.b, 5);
      return { ...w, res: ra && rb ? rb.v - ra.v : null, resDates: ra && rb ? `${ra.t} → ${rb.t}` : "", fx: ua && ub ? (ub.v / ua.v - 1) * 100 : null, fxDates: ua && ub ? `${ua.t} → ${ub.t}` : "" };
    });
  };
  const ivOfMonth = (m: string) => ivRows.find((r) => r.month === m);

  // ---------- marker builders
  const mk = (times: string[], tol: number, mapT?: (d: string) => string) => {
    const out: (SeriesMarker<Time> & { _id: string })[] = [];
    const tm = new Map<string, string[]>();
    for (const e of shown) {
      let t: string | undefined;
      if (mapT) { t = mapT(e.date); if (!times.includes(t)) t = undefined; }
      else { const i = times.findIndex((x) => x >= e.date); if (i >= 0 && (Date.parse(times[i]) - Date.parse(e.date)) / 864e5 <= tol) t = times[i]; }
      if (!t) continue;
      tm.set(t, [...(tm.get(t) || []), e.id]);
      const on = e.id === selId;
      const short = KINDS.find((k) => k.k === e.kind)!.short;
      out.push({ _id: e.id, time: t as Time, position: e.kind === "sale" || e.kind === "drop" ? "belowBar" : "aboveBar", color: on ? css("--text") : kindColor(e.kind), shape: on ? "circle" : e.kind === "sale" || e.kind === "drop" ? "arrowUp" : "arrowDown", text: on ? `▶ ${short}` : short, size: on ? 2 : 1 });
    }
    out.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));
    return { markers: out as SeriesMarker<Time>[], tm };
  };
  const pickNear = (tm: Map<string, string[]>, minTol: number) => (t: string, pxTol: number) => {
    const tol = Math.max(minTol, pxTol);
    let best: string | null = null, bd = Infinity;
    for (const k of tm.keys()) { const dd = Math.abs(Date.parse(k) - Date.parse(t)) / 864e5; if (dd < bd) { bd = dd; best = k; } }
    if (best && bd <= tol) { const ids = tm.get(best)!; const cur = ids.indexOf(selId || ""); select(events.find((e) => e.id === ids[(cur + 1) % ids.length]) || null); }
  };
  const stepKey = (e: RKE<HTMLDivElement>) => {
    if (!shown.length) return;
    const i = sel ? shown.findIndex((x) => x.id === sel.id) : -1;
    if (e.key === "ArrowRight") { e.preventDefault(); select(shown[Math.min(shown.length - 1, i + 1)]); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); select(shown[Math.max(0, i < 0 ? shown.length - 1 : i - 1)]); }
    else if (e.key === "Home") { e.preventDefault(); select(shown[0]); }
    else if (e.key === "End") { e.preventDefault(); select(shown[shown.length - 1]); }
    else if (e.key === "Escape") select(null);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && selId && !(e.target instanceof HTMLInputElement)) set("ev", null); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [selId, sp.toString()]);

  // ---------- chart data
  const uView = useMemo(() => U.filter((p) => inR(p.t)), [U, from]);
  const uTimes = useMemo(() => uView.map((p) => p.t), [uView]);
  const uMk = useMemo(() => {
    const r = mk(uTimes, 5);
    const pt = at(U, pin, 7);
    if (pt && inR(pt.t)) { r.markers = [...r.markers, { time: pt.t as Time, position: "inBar", color: css("--accent"), shape: "square", text: "PIN" } as SeriesMarker<Time>].sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1)); }
    return r;
  }, [uTimes, shown, selId, pin, themeKey]);
  const uSeries: SeriesSpec[] = useMemo(() => [{ kind: "line", data: uView, color: css("--text"), width: 2, title: "USDINR" }], [uView, themeKey]);

  const wView = useMemo(() => W.filter((w) => inR(w.date)), [d, from]);
  const wTimes = useMemo(() => wView.map((w) => w.date), [wView]);
  const wMk = useMemo(() => mk(wTimes, 7), [wTimes, shown, selId, themeKey]);
  const wSeries: SeriesSpec[] = useMemo(() => [
    { kind: "line", data: wView.map((w) => ({ t: w.date, v: w.total / 1000 })), color: css("--text"), width: 2, title: "Total" },
    { kind: "line", data: wView.map((w) => ({ t: w.date, v: w.fca / 1000 })), color: css("--accent"), title: "FCA" },
    { kind: "line", data: wView.map((w) => ({ t: w.date, v: w.gold / 1000 })), color: css("--warn"), title: "Gold", scale: "left" },
  ], [wView, themeKey]);
  const wowSeries: SeriesSpec[] = useMemo(() => [{ kind: "hist", data: wView.filter((w) => w.wow != null).map((w) => ({ t: w.date, v: w.wow! / 1000, color: w.wow! >= 0 ? css("--accent") : css("--warn") })), color: css("--accent"), title: "Weekly chg" }], [wView, themeKey]);
  const wowStats = useMemo(() => { const a = W.map((w) => w.wow).filter((x): x is number => x != null); return { m: mean(a) / 1000, s: sd(a) / 1000 }; }, [d]);

  const ivView = useMemo(() => ivRows.filter((r) => inR(monthEnd(r.month))), [d, from]);
  const ivSeries: SeriesSpec[] = useMemo(() => [
    { kind: "hist", data: ivView.map((r) => ({ t: r.month + "-01", v: r.net / 1000, color: isFlag(r.net) ? (r.net < 0 ? css("--warn") : css("--accent")) : css("--faint") })), color: css("--faint"), title: "Net (US$ bn)" },
    { kind: "line", data: ivView.filter((r) => r.fwd != null).map((r) => ({ t: r.month + "-01", v: r.fwd! / 1000 })), color: css("--muted"), title: "Fwd book", scale: "left", dashed: true },
  ], [ivView, flag, themeKey]);
  const ivMk = useMemo(() => mk(ivView.map((r) => r.month + "-01"), 0, (dd) => dd.slice(0, 7) + "-01"), [ivView, shown, selId, themeKey]);

  const neRows = d?.neer.rows || [];
  const neView = useMemo(() => neRows.filter((r) => inR(r.month + "-28")), [d, from]);
  const neSeries: SeriesSpec[] = useMemo(() => {
    const L = (k: "neer6" | "reer6" | "neer40" | "reer40", color: string, title: string, dashed = false): SeriesSpec => ({ kind: "line", data: neView.filter((r) => r[k] != null).map((r) => ({ t: r.month + "-01", v: r[k]! })), color, title, dashed });
    return [L("neer6", css("--text"), "NEER-6"), L("reer6", css("--accent"), "REER-6"), L("neer40", css("--muted"), "NEER-40", true), L("reer40", css("--warn"), "REER-40", true)].filter((s) => s.data.length);
  }, [neView, themeKey]);
  const neTimes = useMemo(() => neView.filter((r) => r.neer6 != null).map((r) => r.month + "-01"), [neView]);
  const neMk = useMemo(() => mk(neTimes, 0, (dd) => dd.slice(0, 7) + "-01"), [neTimes, shown, selId, themeKey]);

  // ---------- hypothesis tests
  const H = useMemo(() => {
    if (!d) return null;
    // (a) 60d realized vol: USDINR vs peer EM median (same source, same dates)
    const inr = (emS.INR || []).filter((p) => inR(p.t) || p.t >= addDays(from, -120));
    const volI = rollVolPts(inr, 60).filter((p) => inR(p.t));
    const pv: Record<string, Map<string, number>> = {};
    PEERS.forEach((c) => { pv[c] = new Map(rollVolPts((emS[c] || []).filter((p) => p.t >= addDays(from, -120)), 60).map((p) => [p.t, p.v])); });
    const volPeer: P[] = volI.map((p) => ({ t: p.t, v: median(PEERS.map((c) => pv[c].get(p.t)).filter((x): x is number => x != null)) })).filter((p) => Number.isFinite(p.v));
    const peerMap = new Map(volPeer.map((p) => [p.t, p.v]));
    const below = volI.filter((p) => peerMap.has(p.t) && p.v < peerMap.get(p.t)!).length;
    const fullVol = (s: P[]) => { const v = s.filter((p) => inR(p.t)); const r = v.slice(1).map((p, i) => (p.v / v[i].v - 1) * 100); return sd(r) * Math.sqrt(252); };
    const peerTbl = ["INR", ...PEERS].map((c) => ({ c, v: fullVol(emS[c] || []) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
    // (b) monthly: NEER-6 vs USDINR (monthly average, same averaging as RBI's indices)
    const uAvg = monthAvg(U);
    const neMap = new Map<string, number>();
    const ne6 = new Map(neRows.filter((r) => r.neer6 != null).map((r) => [r.month, r.neer6!]));
    const ne0405 = new Map(neRows.filter((r) => r.neer6_0405 != null).map((r) => [r.month, r.neer6_0405!]));
    for (const r of neRows) { // % change within a single base only (never spliced across bases)
      const p = prevMonth(r.month);
      if (ne6.has(r.month) && ne6.has(p)) neMap.set(r.month, (ne6.get(r.month)! / ne6.get(p)! - 1) * 100);
      else if (ne0405.has(r.month) && ne0405.has(p)) neMap.set(r.month, (ne0405.get(r.month)! / ne0405.get(p)! - 1) * 100);
    }
    const uMom = momPct(uAvg);
    const months = [...neMap.keys()].filter((m) => uMom.has(m) && inR(m + "-28")).sort();
    const neStd = rollStd(months, neMap, 12), uStd = rollStd(months, uMom, 12);
    const neCh = months.map((m) => neMap.get(m)!), uCh = months.map((m) => uMom.get(m)!);
    // (c) monthly net intervention vs USDINR month-end % change
    const uLast = monthLast(U);
    const uMe = new Map<string, number>();
    for (const [m, p] of uLast) { const pp = uLast.get(prevMonth(m)); if (pp) uMe.set(m, (p.v / pp.v - 1) * 100); }
    const cPts = ivRows.filter((r) => uMe.has(r.month) && inR(monthEnd(r.month))).map((r) => ({ k: r.month, x: uMe.get(r.month)!, y: r.net / 1000 }));
    const lean = cPts.filter((p) => (p.x > 0 && p.y < 0) || (p.x < 0 && p.y > 0)).length;
    const upM = cPts.filter((p) => p.x > 0), dnM = cPts.filter((p) => p.x < 0);
    // (d) monthly reserves change (last weekly obs of month) vs USDINR month-end % change
    const wLast = monthLast(Wt);
    const dPts: { k: string; x: number; y: number }[] = [];
    for (const [m, p] of wLast) { const pp = wLast.get(prevMonth(m)); if (pp && uMe.has(m) && inR(p.t)) dPts.push({ k: m, x: uMe.get(m)!, y: p.v - pp.v }); }
    const ivMap = new Map(ivRows.map((r) => [r.month, r.net / 1000]));
    const ivRes = dPts.filter((p) => ivMap.has(p.k));
    // (e) adequacy: import cover (months of trailing-12m merchandise imports) and reserves / short-term debt
    const tr = new Map((d.trade.rows || []).map((r) => [r.month, r.imports]));
    const cover: P[] = [];
    for (const [m, p] of wLast) {
      let s = 0, ok = true, k = m;
      for (let i = 0; i < 12; i++) { const v = tr.get(k); if (v == null) { ok = false; break; } s += v; k = prevMonth(k); }
      if (ok && inR(p.t)) cover.push({ t: m + "-01", v: (p.v * 1000) / (s / 12) });
    }
    const stRows = d.debt.rows.map((r) => {
      const res = at(Wt, r.quarter, 7);
      return { q: r.label, quarter: r.quarter, stPctRes: r.stPctReserves, ratioRel: r.stPctReserves ? 100 / r.stPctReserves : null, stBn: r.stUsdBn, res: res?.v ?? null, resT: res?.t ?? "", src: r.src };
    });
    return { volI, volPeer, below, peerTbl, neStd, uStd, neCh, uCh, months, cPts, lean, upM, dnM, dPts, ivRes, ivMap, cover, stRows };
  }, [d, emS, U, Wt, from]);

  // ---------- external debt @ pinned USDINR
  const qSel = sp.get("q") || d?.debt.rows.at(-1)?.quarter || "";
  const debtRow: Debt | undefined = d?.debt.rows.find((r) => r.quarter === qSel) || d?.debt.rows.at(-1);
  const rateAt = (c: string, dd: string) => (c === "INR" ? at(emS.INR || [], dd, 7) : at(emS[c] || [], dd, 7));
  const pinU = at(U, pin, 7), nowU = U.length ? U[U.length - 1] : null;
  const debtCalc = useMemo(() => {
    if (!debtRow || !pinU || !nowU) return null;
    const T = debtRow.total, sh = debtRow.shares;
    const other = Math.max(0, 100 - (sh.INR || 0) - (sh.USD || 0) - (sh.JPY || 0) - (sh.SDR || 0) - (sh.EUR || 0));
    const comp = [
      { c: "USD", pct: sh.USD || 0, how: "USD amount × USDINR" },
      { c: "JPY", pct: sh.JPY || 0, how: "JPY amount (USD-equiv × USDJPY at quarter end) × JPYINR" },
      { c: "EUR", pct: sh.EUR || 0, how: "EUR amount (USD-equiv × USDEUR at quarter end) × EURINR" },
      { c: "SDR", pct: sh.SDR || 0, how: "USD-equiv approximation (no market SDR/INR rate in the ECB set)" },
      { c: "Other", pct: Math.round(other * 10) / 10, how: "USD-equiv approximation (currencies not itemised in the release)" },
    ];
    const valueAt = (c: string, bn: number, dd: string, usdinr: number) => {
      if (c === "JPY" || c === "EUR") {
        const q = rateAt(c, debtRow.quarter), r = rateAt(c, dd);
        if (!q || !r) return { inrCr: null as number | null, ok: false };
        return { inrCr: ((bn * q.v) / r.v) * usdinr * 100, ok: true };
      }
      return { inrCr: bn * usdinr * 100, ok: c === "USD" };
    };
    const rows = comp.map((x) => {
      const bn = (T * x.pct) / 100;
      const a = valueAt(x.c, bn, pinU.t, pinU.v), b = valueAt(x.c, bn, nowU.t, nowU.v);
      return { ...x, bn, pinCr: a.inrCr, nowCr: b.inrCr, exact: a.ok };
    });
    const fxBn = rows.reduce((s, r) => s + r.bn, 0);
    const pinCr = rows.reduce((s, r) => s + (r.pinCr ?? 0), 0), nowCr = rows.reduce((s, r) => s + (r.nowCr ?? 0), 0);
    return { rows, fxBn, pinCr, nowCr, inrBn: (T * (sh.INR || 0)) / 100, usdBn: (T * (sh.USD || 0)) / 100 };
  }, [debtRow, pinU?.t, nowU?.t, emS]);
  const debtHist = useMemo(() => (d?.debt.rows || []).map((r, i, a) => {
    const fx = (r.total * (100 - (r.shares.INR || 0))) / 100;
    const u = at(U, r.quarter, 7);
    const prev = i ? a[i - 1] : null; const pfx = prev ? (prev.total * (100 - (prev.shares.INR || 0))) / 100 : null; const pu = prev ? at(U, prev.quarter, 7) : null;
    const inr = u ? (fx * u.v * 100) / 1e5 : null; // ₹ lakh crore
    const stock = pfx != null && pu ? ((fx - pfx) * pu.v * 100) / 1e5 : null;
    const rate = pu && u ? (fx * (u.v - pu.v) * 100) / 1e5 : null;
    return { ...r, fx, u: u?.v ?? null, uT: u?.t ?? "", inr, stock, rate };
  }), [d, U]);

  // ---------- readout
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
  const R = H && {
    a: H.volI.length && H.volPeer.length ? { inr: mean(H.volI.map((p) => p.v)), peer: mean(H.volPeer.map((p) => p.v)), below: H.below, n: H.volI.length } : null,
    b: H.months.length > 12 ? { ne: sd(H.neCh), u: sd(H.uCh), neMean: mean(H.neCh), negShare: H.neCh.filter((x) => x < 0).length / H.neCh.length, n: H.months.length, from: H.months[0], to: H.months.at(-1)! } : null,
    c: H.cPts.length > 5 ? { r: corr(H.cPts.map((p) => p.x), H.cPts.map((p) => p.y)), lean: H.lean, n: H.cPts.length, upSales: H.upM.filter((p) => p.y < 0).length, up: H.upM.length, dnBuys: H.dnM.filter((p) => p.y > 0).length, dn: H.dnM.length } : null,
    d: H.dPts.length > 5 ? { r: corr(H.dPts.map((p) => p.x), H.dPts.map((p) => p.y)), n: H.dPts.length, rIv: corr(H.ivRes.map((p) => H.ivMap.get(p.k)!), H.ivRes.map((p) => p.y)), nIv: H.ivRes.length } : null,
    e: { cover: H.cover.at(-1), coverMin: H.cover.length ? H.cover.reduce((a, b) => (b.v < a.v ? b : a)) : null, st: H.stRows.at(-1) },
  };

  // ---------- CSVs
  const foot = (s: { source: string; sourceUrl: string; retrieved: string; caveat?: string }) => [`source: ${s.source} ${s.sourceUrl}`, `retrieved: ${s.retrieved}`, ...(s.caveat ? [`caveat: ${s.caveat}`] : [])];
  const csvW = () => d && downloadCsv("rbi_fx_reserves_weekly.csv", ["as_on", "published", "total_usd_mn", "fca_usd_mn", "gold_usd_mn", "sdr_usd_mn", "imf_rtp_usd_mn", "total_inr_cr", "weekly_change_usd_mn", "source_url"], wView.map((w) => [w.date, w.pub, w.total, w.fca, w.gold, w.sdr, w.imf, w.totalInrCr, w.wow, w.src]), foot(d.weekly));
  const csvIv = () => d && downloadCsv("rbi_fx_intervention_monthly.csv", ["month", "purchase_usd_mn", "sale_usd_mn", "net_usd_mn", "outstanding_net_forward_usd_mn", "flagged", "flag_rule", "source", "source_url"], ivView.map((r) => [r.month, r.purchase, r.sale, r.net, r.fwd, isFlag(r.net) ? (r.net < 0 ? "large_sale" : "large_purchase") : "", flagRule, r.srcLabel, r.src]), foot(d.intervention));
  const csvNe = () => d && downloadCsv("rbi_neer_reer_monthly.csv", ["month", "neer6_2015_16", "reer6_2015_16", "neer6_2004_05", "reer6_2004_05", "neer40_2015_16", "reer40_2015_16", "source_url"], neView.map((r) => [r.month, r.neer6, r.reer6, r.neer6_0405, r.reer6_0405, r.neer40, r.reer40, r.src || r.src40]), foot(d.neer));
  const csvDebt = () => d && downloadCsv("india_external_debt_fx_pinned.csv", ["quarter_end", "release", "total_usd_bn", "usd_pct", "inr_pct", "jpy_pct", "sdr_pct", "eur_pct", "fx_denominated_usd_bn", "usdinr_at_quarter_end", "fx_debt_inr_lakh_cr_at_quarter_end", "st_pct_total", "st_pct_reserves", "debt_service_ratio", "source_url"],
    debtHist.map((r) => [r.quarter, r.release, r.total, r.shares.USD, r.shares.INR, r.shares.JPY, r.shares.SDR, r.shares.EUR, r.fx.toFixed(2), r.u, r.inr?.toFixed(3), r.stPctTotal, r.stPctReserves, r.dsr, r.src]),
    [...foot(d.debt), ...(debtCalc && pinU && nowU ? [`pinned calc for ${debtRow?.label}: USDINR ${pinU.v} on ${pinU.t} vs ${nowU.v} on ${nowU.t}`, ...debtCalc.rows.map((r) => `${r.c}: ${r.bn.toFixed(2)} bn USD-eq; INR cr @pin ${r.pinCr?.toFixed(0)}; @latest ${r.nowCr?.toFixed(0)}; method ${r.how}`)] : []), `USDINR source: ${usd?.sourceUrl}`]);
  const csvH = () => H && downloadCsv("hypothesis_tests_monthly.csv", ["month", "usdinr_monthend_pct", "rbi_net_usd_bn", "reserves_change_usd_bn", "neer6_mom_pct", "usdinr_monthavg_mom_pct", "goods_import_cover_months"],
    [...new Set([...H.cPts.map((p) => p.k), ...H.dPts.map((p) => p.k), ...H.months])].sort().map((m) => [m, H.cPts.find((p) => p.k === m)?.x.toFixed(3) ?? H.dPts.find((p) => p.k === m)?.x.toFixed(3), H.ivMap.get(m), H.dPts.find((p) => p.k === m)?.y.toFixed(3), H.months.includes(m) ? H.neCh[H.months.indexOf(m)].toFixed(3) : "", H.months.includes(m) ? H.uCh[H.months.indexOf(m)].toFixed(3) : "", H.cover.find((p) => p.t.startsWith(m))?.v.toFixed(2)]),
    ["USDINR: " + (usd?.sourceUrl || ""), "intervention: " + (d?.intervention.sourceUrl || ""), "reserves: " + (d?.weekly.sourceUrl || ""), "NEER: " + (d?.neer.sourceUrl || ""), "imports: " + (d?.trade.source || "")]);
  const [sortK, setSortK] = useState<"date" | "kind" | "iv" | "fx">("date");
  const [sortD, setSortD] = useState<1 | -1>(-1);
  const effCache = useMemo(() => new Map(shown.map((e) => [e.id, effect(e)])), [shown, Wt, U]);
  const evRows = useMemo(() => {
    const k = (e: Ev): string | number | null => sortK === "date" ? e.date : sortK === "kind" ? e.kind : sortK === "iv" ? (e.ivNet ?? ivOfMonth(e.date.slice(0, 7))?.net ?? null) : (effCache.get(e.id)!.at(-1)!.fx ?? null);
    return [...shown].sort((a, b) => { const x = k(a), y = k(b); if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; return (x < y ? -1 : x > y ? 1 : 0) * sortD; });
  }, [shown, sortK, sortD, effCache]);
  const csvEv = () => downloadCsv("reserves_events.csv", ["date", "kind", "title", "text", "rbi_net_month_usd_mn", "reserves_chg_window1_usd_bn", "usdinr_pct_window1", "reserves_chg_+1m_usd_bn", "usdinr_pct_+1m", "source", "source_url"],
    evRows.map((e) => { const f = effCache.get(e.id)!; return [e.date, e.kind, e.title, e.text, e.ivNet ?? ivOfMonth(e.date.slice(0, 7))?.net, f[0].res?.toFixed(3), f[0].fx?.toFixed(3), f.at(-1)!.res?.toFixed(3), f.at(-1)!.fx?.toFixed(3), e.srcLabel, e.src]; }),
    ["effects are computed from RBI weekly reserves and ECB daily USDINR; 'n/a' where a window has no data; intervention data is monthly so effects for S/P events are month-level"]);
  const sortBtn = (k: typeof sortK, label: string) => (
    <th aria-sort={sortK === k ? (sortD === 1 ? "ascending" : "descending") : "none"}><button className="th-btn" onClick={() => { if (sortK === k) setSortD((x) => (x === 1 ? -1 : 1)); else { setSortK(k); setSortD(k === "date" ? -1 : 1); } }}>{label}{sortK === k ? (sortD === 1 ? " ▲" : " ▼") : ""}</button></th>
  );
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sel && cardRef.current) cardRef.current.focus({ preventScroll: true }); }, [selId]);

  if (!d) return <div className="reserves"><header className="page-h"><h1>Reserves &amp; Debt</h1></header><div className="panel pad mono faint">{err.length ? err.join(" · ") : "loading RBI data…"}</div></div>;
  const lastW = W.at(-1)!, lastIv = ivRows.at(-1)!, lastNe = neRows.filter((r) => r.neer6 != null).at(-1)!, lastDebt = d.debt.rows.at(-1)!;
  const lagDays = (a: string) => Math.round((Date.parse(d.generated) - Date.parse(a)) / 864e5);

  const card = sel && (() => {
    const f = effect(sel); const ivm = sel.monthly ? undefined : ivOfMonth(sel.date.slice(0, 7));
    return (
      <div className="ev-card" ref={cardRef} tabIndex={-1} onKeyDown={stepKey} role="region" aria-live="polite" aria-label={`Event detail: ${sel.title}`}>
        <div className="ev-card-h"><span className={`ev-dot k-${sel.kind}`} aria-hidden="true" />{dayLabel(sel.date)}{sel.monthly ? ` (month-end; data for ${monLabel(sel.monthly)})` : ""} · {KINDS.find((k) => k.k === sel.kind)!.label}
          <span className="ev-nav"><button className="chip" onClick={() => { const i = shown.findIndex((x) => x.id === sel.id); if (i > 0) select(shown[i - 1]); }} aria-label="Previous event">‹</button><button className="chip" onClick={() => { const i = shown.findIndex((x) => x.id === sel.id); if (i >= 0 && i < shown.length - 1) select(shown[i + 1]); }} aria-label="Next event">›</button><button className="chip" onClick={() => select(null)} aria-label="Close event detail">×</button></span></div>
        <p className="ev-title">{sel.title}</p>
        <p>{sel.text} <a href={sel.src} target="_blank" rel="noreferrer">Source: {sel.srcLabel}</a></p>
        <p className="mono">RBI net intervention: {sel.ivNet != null ? `${sg(sel.ivNet / 1000, 2)} bn US$ in ${monLabel(sel.monthly!)}` : ivm ? `${sg(ivm.net / 1000, 2)} bn US$ in ${monLabel(ivm.month)} (whole month, not this day)` : "n/a (month not yet published or outside data range)"}</p>
        <table className="tbl mono ev-eff"><thead><tr><th>Window</th><th>Reserves Δ (US$ bn)</th><th>USDINR %</th></tr></thead>
          <tbody>{f.map((w) => <tr key={w.l}><th>{w.l}</th><td title={w.resDates}>{sg(w.res, 2)}</td><td className={vsTone(w.fx)} title={w.fxDates}>{sg(w.fx, 2)}{w.fx != null ? "%" : ""}</td></tr>)}</tbody></table>
        <p className="meta faint">Measured, not attributed: windows use the last RBI weekly reserves reading and ECB USDINR fix on/before each end date ('n/a' if a window runs past available data). Weekly reserves include valuation effects. Intervention data is monthly, so any intervention effect is month-level. Green USDINR = USD up vs INR, red = USD down vs INR.</p>
      </div>
    );
  })();

  return (
    <div className="reserves history">
      <header className="page-h">
        <h1>Reserves &amp; Debt</h1>
        <p className="lede">Tests of one hypothesis: that RBI runs a managed, crawl-like rupee against its 6-currency basket and spends reserves to resist market moves. Panels show RBI's published data and simple statistics. They are tests, not conclusions, and nothing here is a forecast or a trade signal.</p>
      </header>

      <section className="panel h-controls" aria-label="Page controls">
        <div className="seg" role="group" aria-label="Range">{Object.keys(RANGES).map((k) => <button key={k} className={range === k ? "on" : ""} aria-pressed={range === k} onClick={() => set("range", k === "Max" ? null : k)}>{k}</button>)}</div>
        <label>Pin USDINR date <input type="date" value={pin} min={usd?.from} max={usd?.to} onChange={(e) => set("pin", e.target.value)} /></label>
        <span className="mono">{pinU ? <>USDINR {pinU.v.toFixed(4)} on {pinU.t}</> : pin ? "no ECB fix within 7 days of that date" : ""}</span>
        <label>Flag months <select value={flag} onChange={(e) => set("flag", e.target.value === "2s" ? null : e.target.value)}><option value="2s">beyond 2σ</option><option value="5">|net| ≥ US$ 5 bn</option><option value="10">|net| ≥ US$ 10 bn</option><option value="15">|net| ≥ US$ 15 bn</option></select></label>
      </section>
      {err.length > 0 && <div className="panel warn mono pad">Some live data is unavailable: {err.join(" · ")}. RBI panels still render from the static dataset.</div>}

      <section className="panel status-strip" aria-label="Data coverage">
        <div className="panel-h">Data coverage and lags <span className="meta">dataset built {d.generated} by <code>{d.script}</code></span></div>
        <div className="tbl-wrap"><table className="tbl mono cov">
          <thead><tr><th>Series</th><th>Frequency</th><th>Range</th><th>Latest</th><th>Lag vs build</th><th>Source</th></tr></thead>
          <tbody>
            <tr><td>FX reserves (weekly)</td><td>weekly</td><td>{W[0].date} → {lastW.date}</td><td>US$ {fmt(lastW.total / 1000, 1)} bn (as on {lastW.date}, pub. {lastW.pub})</td><td>{lagDays(lastW.date)}d</td><td><a href={lastW.src} target="_blank" rel="noreferrer">RBI WSS</a></td></tr>
            <tr><td>RBI net FX intervention</td><td>monthly</td><td>{ivRows[0].month} → {lastIv.month}</td><td>{sg(lastIv.net / 1000, 2)} bn ({monLabel(lastIv.month)})</td><td>{lagDays(monthEnd(lastIv.month))}d</td><td><a href={lastIv.src} target="_blank" rel="noreferrer">{lastIv.srcLabel}</a></td></tr>
            <tr><td>NEER/REER (6 &amp; 40)</td><td>monthly avg</td><td>{neRows[0].month} → {lastNe.month}</td><td>NEER-6 {lastNe.neer6} ({monLabel(lastNe.month)})</td><td>{lagDays(monthEnd(lastNe.month))}d</td><td><a href={lastNe.src} target="_blank" rel="noreferrer">RBI Bulletin</a></td></tr>
            <tr><td>External debt</td><td>quarterly (Mar, Jun from RBI)</td><td>{d.debt.rows[0].label} → {lastDebt.label}</td><td>US$ {lastDebt.total} bn</td><td>{lagDays(lastDebt.quarter)}d</td><td><a href={lastDebt.src} target="_blank" rel="noreferrer">RBI press release</a></td></tr>
            <tr><td>Merchandise imports</td><td>monthly</td><td>{d.trade.rows[0].month} → {d.trade.rows.at(-1)!.month}</td><td>US$ {fmt(d.trade.rows.at(-1)!.imports / 1000, 1)} bn</td><td>{lagDays(monthEnd(d.trade.rows.at(-1)!.month))}d</td><td><a href={d.trade.rows.at(-1)!.src} target="_blank" rel="noreferrer">RBI Bulletin (DGCI&amp;S)</a></td></tr>
            <tr><td>USDINR + peer FX (daily)</td><td>daily (ECB fix)</td><td>{usd?.from || "…"} → {usd?.to || "…"}</td><td>{nowU ? `${nowU.v.toFixed(4)} (${nowU.t})` : "…"}</td><td>{nowU ? lagDays(nowU.t) + "d" : ""}</td><td>{usd ? <a href={usd.sourceUrl} target="_blank" rel="noreferrer">Frankfurter / ECB</a> : "…"}</td></tr>
          </tbody>
        </table></div>
        {d.notes.length > 0 && <p className="meta faint pad">Not yet available as HTML: {d.notes.join("; ")}.</p>}
      </section>

      <section className="panel" aria-label="Event markers">
        <div className="panel-h">Event markers <span className="meta">click a marker or a row · focus a chart and use ←/→ to step, Esc to close</span></div>
        <div className="kind-row" role="group" aria-label="Event types">
          {KINDS.map((k) => { const on = kindsOn.has(k.k); return <button key={k.k} className={`chip k-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => { const n = new Set(kindsOn); on ? n.delete(k.k) : n.add(k.k); set("kinds", [...n].join(",") || ","); }}><span className={`ev-dot k-${k.k}`} aria-hidden="true" />{k.short} · {k.label} ({events.filter((e) => e.kind === k.k && inR(e.date)).length})</button>; })}
        </div>
        {card}
      </section>

      <section className="panel">
        <div className="panel-h">USDINR daily (ECB reference) with events <span className="meta">rising line = USD up vs INR (INR weaker) · PIN = pinned date for the debt panel · {usd && <a href={usd.sourceUrl} target="_blank" rel="noreferrer">{usd.source}</a>}</span></div>
        {uView.length > 1 ? <EvChart series={uSeries} markers={uMk.markers} height={320} themeKey={themeKey} onPick={pickNear(uMk.tm, 6)} focus={sel?.date} label={`USDINR chart with ${uMk.markers.length} event markers. Left and right arrows step through events; Escape closes the detail.`} onKey={stepKey} /> : <div className="mono faint pad">— loading USDINR</div>}
      </section>

      <section className="panel">
        <div className="panel-h">1 · FX reserves, weekly (US$ bn) <span><button className="chip" onClick={csvW}>CSV</button></span></div>
        <div className="kpis mono">
          <span>Total <b>{fmt(lastW.total / 1000, 1)}</b></span><span>FCA <b>{fmt(lastW.fca / 1000, 1)}</b></span><span>Gold <b>{fmt(lastW.gold / 1000, 1)}</b></span><span>SDR <b>{fmt(lastW.sdr / 1000, 2)}</b></span><span>IMF RTP <b>{fmt(lastW.imf / 1000, 2)}</b></span>
          <span>Week chg <b>{sg((lastW.wow ?? NaN) / 1000, 2)}</b></span><span className="faint">as on {lastW.date} · pub. {lastW.pub} · ₹{fmt(lastW.totalInrCr / 1e5, 2)} lakh cr</span>
        </div>
        <EvChart series={wSeries} markers={wMk.markers} height={260} themeKey={themeKey} onPick={pickNear(wMk.tm, 8)} focus={sel?.date} label={`Weekly reserves chart with ${wMk.markers.length} event markers. Left and right arrows step through events.`} onKey={stepKey} />
        <div className="legend-row mono pad"><span><i style={{ background: css("--text") }} />Total (right)</span><span><i style={{ background: css("--accent") }} />FCA (right)</span><span><i style={{ background: css("--warn") }} />Gold (left axis)</span></div>
        <div className="panel-h sub">Weekly change, US$ bn <span className="meta">mean {sg(wowStats.m, 2)} · σ {fmt(wowStats.s, 2)} · R markers = weeks below mean − 2σ</span></div>
        <EvChart series={wowSeries} height={130} themeKey={themeKey} label="Weekly change in reserves, bar chart" />
        <p className="meta faint pad"><Src s={d.weekly} extra={`${W.length} weeks, ${W[0].date} → ${lastW.date}; cross-checked against Handbook Table 215`} /> {d.weekly.caveat}</p>
      </section>

      <section className="panel">
        <div className="panel-h">2 · RBI net FX intervention, monthly (US$ bn) <span><button className="chip" onClick={csvIv}>CSV</button></span></div>
        <div className="kpis mono"><span>Latest {monLabel(lastIv.month)}: net <b>{sg(lastIv.net / 1000, 2)}</b></span><span>purchase {fmt(lastIv.purchase / 1000, 2)}</span><span>sale {fmt(lastIv.sale / 1000, 2)}</span><span>fwd book {fmt((lastIv.fwd ?? NaN) / 1000, 1)}</span><span className="faint">flag rule: {flagRule}</span></div>
        <EvChart series={ivSeries} markers={ivMk.markers} height={240} themeKey={themeKey} onPick={pickNear(ivMk.tm, 20)} focus={sel ? sel.date.slice(0, 7) + "-01" : null} label="Monthly net intervention bars with forward-book line" onKey={stepKey} />
        <div className="legend-row mono pad"><span><i style={{ background: css("--warn") }} />flagged net sale</span><span><i style={{ background: css("--accent") }} />flagged net purchase</span><span><i style={{ background: css("--faint") }} />other months</span><span><i style={{ background: css("--muted") }} />outstanding net forward (left axis, dashed)</span></div>
        <div className="tbl-wrap pad"><table className="tbl mono"><thead><tr><th>Flagged month</th><th>Purchase</th><th>Sale</th><th>Net</th><th>Fwd book</th><th>Source</th></tr></thead>
          <tbody>{ivView.filter((r) => isFlag(r.net)).reverse().map((r) => <tr key={r.month}><td><button className="linkish" onClick={() => select(events.find((e) => e.id === `iv-${r.month}`) || null)}>{monLabel(r.month)}</button></td><td>{fmt(r.purchase / 1000, 2)}</td><td>{fmt(r.sale / 1000, 2)}</td><td>{sg(r.net / 1000, 2)}</td><td>{fmt((r.fwd ?? NaN) / 1000, 1)}</td><td><a href={r.src} target="_blank" rel="noreferrer">{r.srcLabel.replace("RBI ", "")}</a></td></tr>)}</tbody></table></div>
        <p className="meta faint pad"><Src s={d.intervention} /> {d.intervention.caveat}</p>
      </section>

      <section className="panel">
        <div className="panel-h">3 · Rupee NEER / REER, monthly (base 2015-16 = 100) <span><button className="chip" onClick={csvNe}>CSV</button></span></div>
        <div className="kpis mono"><span>{monLabel(lastNe.month)}: NEER-6 <b>{lastNe.neer6}</b></span><span>REER-6 <b>{lastNe.reer6}</b></span><span>NEER-40 {lastNe.neer40 ?? "n/a"}</span><span>REER-40 {lastNe.reer40 ?? "n/a"}</span><span className="faint">higher = rupee stronger</span></div>
        <EvChart series={neSeries} markers={neMk.markers} height={260} themeKey={themeKey} onPick={pickNear(neMk.tm, 20)} focus={sel ? sel.date.slice(0, 7) + "-01" : null} label={`NEER and REER chart with ${neMk.markers.length} event markers`} onKey={stepKey} />
        <div className="legend-row mono pad"><span><i style={{ background: css("--text") }} />NEER 6-currency</span><span><i style={{ background: css("--accent") }} />REER 6-currency</span><span><i style={{ background: css("--muted") }} />NEER 40-currency (dashed)</span><span><i style={{ background: css("--warn") }} />REER 40-currency (dashed)</span></div>
        <p className="meta faint pad"><Src s={d.neer} /> {d.neer.caveat} 40-currency months missing from the bulletin HTML or Handbook are left blank.</p>
      </section>

      <section className="panel">
        <div className="panel-h">4 · External debt in foreign currency, valued at a pinned USDINR <span><button className="chip" onClick={csvDebt}>CSV</button></span></div>
        <div className="h-controls pad">
          <label>Debt stock as of <select value={debtRow?.quarter} onChange={(e) => set("q", e.target.value)}>{d.debt.rows.map((r) => <option key={r.quarter} value={r.quarter}>{r.label}</option>)}</select></label>
          <span className="mono">Total US$ {debtRow?.total} bn · INR-denominated {fmt(debtCalc?.inrBn, 1)} bn ({debtRow?.shares.INR}%) · <b>FX-denominated {fmt(debtCalc?.fxBn, 1)} bn</b> · <a href={debtRow?.src} target="_blank" rel="noreferrer">release {debtRow?.release}</a></span>
        </div>
        {debtCalc && pinU && nowU ? (<>
          <div className="kpis mono big">
            <span>INR value of FX debt @ {pinU.t} (USDINR {pinU.v.toFixed(2)}): <b>₹{fmt(debtCalc.pinCr / 1e5, 2)} lakh cr</b></span>
            <span>@ latest {nowU.t} ({nowU.v.toFixed(2)}): <b>₹{fmt(debtCalc.nowCr / 1e5, 2)} lakh cr</b></span>
            <span className={vsTone(debtCalc.nowCr - debtCalc.pinCr)}>Δ ₹{sg((debtCalc.nowCr - debtCalc.pinCr) / 1e5, 2)} lakh cr ({sg((debtCalc.nowCr / debtCalc.pinCr - 1) * 100, 1)}%)</span>
          </div>
          <div className="kpis mono"><span>Sensitivity, USD portion: <b>₹{fmt(debtCalc.usdBn * 100, 0)} cr per ₹1 move in USDINR</b></span><span>All FX debt (USD-equiv approximation, crosses held fixed): ₹{fmt(debtCalc.fxBn * 100, 0)} cr per ₹1</span></div>
          <div className="tbl-wrap pad"><table className="tbl mono"><thead><tr><th>Currency</th><th>Share</th><th>US$-eq bn at {debtRow?.label}</th><th>₹ cr @ pin</th><th>₹ cr @ latest</th><th>Δ ₹ cr</th><th>Method</th></tr></thead>
            <tbody>{debtCalc.rows.map((r) => <tr key={r.c}><td>{r.c}</td><td>{r.pct}%</td><td>{fmt(r.bn, 1)}</td><td>{fmt(r.pinCr, 0)}</td><td>{fmt(r.nowCr, 0)}</td><td className={vsTone((r.nowCr ?? NaN) - (r.pinCr ?? NaN))}>{r.pinCr != null && r.nowCr != null ? sg(r.nowCr - r.pinCr, 0) : "n/a"}</td><td className={r.exact ? "" : "faint"}>{r.how}</td></tr>)}</tbody></table></div>
          <p className="meta faint pad">This revalues a fixed debt stock (as published for {debtRow?.label}) at two exchange rates. It is not a projection of future debt. JPY and EUR amounts are recovered from the release's US$-equivalent shares using the ECB rate at quarter-end, then converted at that currency's own INR cross on each date. SDR and unitemised currencies use the USD-equivalent approximation. Green Δ = that currency rose vs INR since the pinned date, so the rupee cost of the same debt went up; red = it fell. {debtRow?.valuation ? `Release note: "${debtRow.valuation}"` : ""}</p>
        </>) : <div className="mono faint pad">— waiting for USDINR history</div>}
        <div className="panel-h sub">Quarterly history: how the rupee value of FX debt moved <span className="meta">change split into stock effect (Δ US$ stock × old rate) and rate effect (new stock × Δ USDINR); all FX debt treated as USD-equivalent here</span></div>
        <div className="tbl-wrap pad"><table className="tbl mono"><thead><tr><th>Quarter end</th><th>Total</th><th>USD %</th><th>INR %</th><th>JPY %</th><th>SDR %</th><th>EUR %</th><th>FX debt US$ bn</th><th>USDINR</th><th>₹ lakh cr</th><th>stock eff.</th><th>rate eff.</th><th>ST % total</th><th>ST % reserves</th><th>DSR %</th><th>Src</th></tr></thead>
          <tbody>{[...debtHist].reverse().map((r) => <tr key={r.quarter}><td>{r.label}</td><td>{r.total}</td><td>{r.shares.USD}</td><td>{r.shares.INR}</td><td>{r.shares.JPY ?? "n/a"}</td><td>{r.shares.SDR ?? "n/a"}</td><td>{r.shares.EUR ?? "n/a"}</td><td>{fmt(r.fx, 1)}</td><td title={r.uT}>{fmt(r.u, 2)}</td><td>{fmt(r.inr, 2)}</td><td>{sg(r.stock, 2)}</td><td className={vsTone(r.rate)}>{sg(r.rate, 2)}</td><td>{r.stPctTotal ?? "n/a"}</td><td>{r.stPctReserves ?? "n/a"}</td><td>{r.dsr ?? "n/a"}</td><td><a href={r.src} target="_blank" rel="noreferrer">PR</a></td></tr>)}</tbody></table></div>
        <p className="meta faint pad"><Src s={d.debt} /> {d.debt.caveat} Long annual history (end-March 1991 → 2026, totals and ratios): <a href={d.debtAnnual.sourceUrl} target="_blank" rel="noreferrer">{d.debtAnnual.source}</a>; end-March 2026 total US$ {d.debtAnnual.rows.at(-1)?.total} bn, short-term debt / reserves {d.debtAnnual.rows.at(-1)?.stToRes}%.</p>
      </section>

      {H && R && (
        <section className="panel">
          <div className="panel-h">5 · Hypothesis tests <span><button className="chip" onClick={csvH}>CSV</button></span></div>
          <div className="h-grid">
            <div>
              <div className="panel-h sub">(a) 60-day realized vol: USDINR vs peer-EM median <span className="meta">annualized σ of daily % changes, all vs USD, ECB fixes</span></div>
              <EvChart series={[{ kind: "line", data: H.volI, color: css("--text"), width: 2, title: "USDINR" }, { kind: "line", data: H.volPeer, color: css("--warn"), title: "peer median" }]} height={200} themeKey={themeKey} label="Rolling volatility of USDINR versus peer emerging-market median" />
              <p className="mono small pad">{H.peerTbl.map((x, i) => <span key={x.c} className={x.c === "INR" ? "hl" : ""}>{i + 1}. {x.c} {x.v.toFixed(1)}%{i < H.peerTbl.length - 1 ? " · " : ""}</span>)}</p>
            </div>
            <div>
              <div className="panel-h sub">(b) 12-month rolling σ of monthly % changes: NEER-6 vs USDINR <span className="meta">USDINR monthly average, matching RBI's monthly-average indices</span></div>
              <EvChart series={[{ kind: "line", data: H.neStd, color: css("--accent"), width: 2, title: "NEER-6 σ" }, { kind: "line", data: H.uStd, color: css("--text"), title: "USDINR σ" }]} height={200} themeKey={themeKey} label="Rolling standard deviation of NEER-6 and USDINR monthly changes" />
            </div>
            <div>
              <div className="panel-h sub">(c) Monthly net intervention vs USDINR % change <span className="meta">x: USDINR month-end % (right = INR weaker) · y: RBI net US$ bn</span></div>
              <Scatter pts={H.cPts} xLabel="USDINR %" yLabel="RBI net US$ bn" colorOf={(p) => (p.y < 0 ? css("--warn") : css("--accent"))} />
            </div>
            <div>
              <div className="panel-h sub">(d) Monthly reserves change vs USDINR % change <span className="meta">x: USDINR month-end % · y: Δ reserves US$ bn (last weekly reading per month)</span></div>
              <Scatter pts={H.dPts} xLabel="USDINR %" yLabel="Δ reserves US$ bn" colorOf={(p) => (p.y < 0 ? css("--warn") : css("--accent"))} />
            </div>
            <div>
              <div className="panel-h sub">(e) Reserve adequacy: goods-import cover (months) <span className="meta">month-end reserves ÷ (trailing-12m merchandise imports ÷ 12)</span></div>
              {H.cover.length ? <EvChart series={[{ kind: "line", data: H.cover, color: css("--accent"), width: 2, title: "months" }]} height={200} themeKey={themeKey} label="Goods import cover in months" /> : <div className="mono faint pad">— needs 12 consecutive months of imports</div>}
            </div>
            <div>
              <div className="panel-h sub">(e) Reserves vs short-term debt (original maturity) <span className="meta">from each RBI external-debt release</span></div>
              <div className="tbl-wrap pad"><table className="tbl mono"><thead><tr><th>Quarter</th><th>ST debt % of reserves</th><th>Reserves ÷ ST debt</th><th>ST debt US$ bn</th><th>Reserves (WSS) US$ bn</th></tr></thead>
                <tbody>{[...H.stRows].reverse().map((r) => <tr key={r.q}><td><a href={r.src} target="_blank" rel="noreferrer">{r.q}</a></td><td>{r.stPctRes ?? "n/a"}</td><td>{r.ratioRel ? r.ratioRel.toFixed(1) + "×" : "n/a"}</td><td>{fmt(r.stBn, 1)}</td><td title={r.resT}>{fmt(r.res, 1)}</td></tr>)}</tbody></table></div>
            </div>
          </div>
          <div className="readout pad">
            <h2>What the data currently shows (range: {range === "Max" ? "all available" : range})</h2>
            <ul>
              {R.a && <li><b>(a) Relative volatility.</b> USDINR 60-day realized vol averaged {R.a.inr.toFixed(1)}% vs {R.a.peer.toFixed(1)}% for the median of {PEERS.join(", ")}; INR was below the peer median on {pct(R.a.below, R.a.n)} of {R.a.n} days. Over the full range INR ranks {H.peerTbl.findIndex((x) => x.c === "INR") + 1} of {H.peerTbl.length} by volatility (1 = calmest). <i>Supports:</i> unusually smooth USDINR, which fits active smoothing. <i>Doesn't show:</i> why. Capital-account rules, the INR's trade mix and CNY's own management also lower vol.</li>}
              {R.b && <li><b>(b) Basket vs dollar.</b> From {monLabel(R.b.from)} to {monLabel(R.b.to)} ({R.b.n} months), σ of monthly % changes is {R.b.ne.toFixed(2)}% for NEER-6 vs {R.b.u.toFixed(2)}% for USDINR. NEER-6 averaged {sg(R.b.neMean, 2)}% a month and fell in {Math.round(R.b.negShare * 100)}% of months. {R.b.ne < R.b.u * 0.9 ? "The basket is clearly steadier than the dollar rate, which is what a basket anchor would produce." : R.b.ne > R.b.u * 1.1 ? "The basket is less steady than the dollar rate, which points to a dollar-focused rather than a basket-focused anchor." : "The basket and the dollar rate are about equally volatile, so this test cannot tell a basket anchor from a dollar anchor."} A steady negative drift is the "crawl" signature; a rising REER alongside a falling NEER means inflation differentials are eating the nominal crawl.</li>}
              {R.c && <li><b>(c) Sign check.</b> In {R.c.n} months, intervention leaned against the move (net sales when USDINR rose, net purchases when it fell) in {R.c.lean} ({pct(R.c.lean, R.c.n)}); correlation r = {R.c.r.toFixed(2)}. Of {R.c.up} months when USDINR rose, RBI was a net seller in {R.c.upSales}; of {R.c.dn} months when it fell, a net buyer in {R.c.dnBuys}. <i>Supports:</i> {R.c.r < -0.2 ? "a lean-against-the-wind pattern." : "only a weak lean-against-the-wind pattern."} <i>Doesn't show:</i> causation. RBI reacts to moves and moves react to RBI within the same month, and month totals hide intra-month two-way trading.</li>}
              {R.d && <li><b>(d) Reserves vs INR.</b> Monthly reserves change vs USDINR % change: r = {R.d.r.toFixed(2)} ({R.d.n} months). Net intervention vs reserves change: r = {R.d.rIv.toFixed(2)} ({R.d.nIv} months). The gap between the two is mostly valuation (USD vs EUR/JPY/GBP, gold price), interest income and forward-book settlements, so weekly or monthly reserve drops overstate or understate actual FX sales.</li>}
              <li><b>(e) Adequacy.</b> {R.e.cover ? <>Goods-import cover was {R.e.cover.v.toFixed(1)} months at {monLabel(R.e.cover.t.slice(0, 7))} (range low {R.e.coverMin!.v.toFixed(1)} in {monLabel(R.e.coverMin!.t.slice(0, 7))}). </> : null}{R.e.st ? <>At {R.e.st.q}, short-term debt by original maturity was {R.e.st.stPctRes}% of reserves, so reserves cover it {R.e.st.ratioRel?.toFixed(1)}×. </> : null}By residual maturity (all debt falling due within a year), the <a href={d.debtAnnual.sourceUrl} target="_blank" rel="noreferrer">Sep 30, 2026 release</a> puts short-term debt at 50.5% of reserves for end-June 2026, a much tighter measure.</li>
              <li><b>Not testable with this data:</b> whether there is an explicit target level or crawl rate; daily intervention timing; the offshore NDF market; the split between spot and forward books before settlement. Intervention data is monthly with a ~2–3 month lag, and Sep/Dec debt quarters (Ministry of Finance) are not included.</li>
            </ul>
          </div>
        </section>
      )}

      <section className="panel" aria-label="Event list">
        <div className="panel-h">Event list ({evRows.length} in range) <span><button className="chip" onClick={csvEv}>CSV</button></span></div>
        <div className="tbl-wrap pad ev-list"><table className="tbl mono">
          <thead><tr>{sortBtn("date", "Date")}{sortBtn("kind", "Type")}<th className="l">Event</th>{sortBtn("iv", "RBI net (month, US$ bn)")}<th>Reserves Δ (first window)</th>{sortBtn("fx", "USDINR % (+1m)")}<th>Source</th></tr></thead>
          <tbody>{evRows.map((e) => { const f = effCache.get(e.id)!; const ivn = e.ivNet ?? ivOfMonth(e.date.slice(0, 7))?.net; const on = e.id === selId; return (
            <tr key={e.id} className={on ? "on" : ""} aria-selected={on}>
              <td><button className="linkish" onClick={() => select(on ? null : e)} aria-label={`${on ? "Close" : "Open"} detail for ${e.title}`}>{e.date}</button></td>
              <td><span className={`ev-dot k-${e.kind}`} aria-hidden="true" />{KINDS.find((k) => k.k === e.kind)!.short}</td>
              <td className="ev-t">{e.title}</td><td>{ivn != null ? sg(ivn / 1000, 2) : "n/a"}</td><td>{sg(f[0].res, 2)} <span className="faint">({f[0].l})</span></td><td className={vsTone(f.at(-1)!.fx)}>{sg(f.at(-1)!.fx, 2)}</td>
              <td><a href={e.src} target="_blank" rel="noreferrer">link</a></td></tr>); })}</tbody>
        </table></div>
        <p className="meta faint pad">Events come from RBI data (flagged intervention months, weekly drops below mean − 2σ), the ECB USDINR series (first new high of each month since 2019), RBI MPC resolutions and the Federal Reserve FOMC calendar ({d.events.rows.filter((e) => e.kind === "fomc")[0]?.date} onward). No event is entered by hand without a source link.</p>
      </section>
    </div>
  );
}
