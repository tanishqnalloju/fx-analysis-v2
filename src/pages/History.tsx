import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createChart, type IChartApi, type SeriesMarker, type Time } from "lightweight-charts";
import { dow, drawdown, mean, monthly, rets, rollCorr, rollVol, sd, sma, type P } from "../lib/histstats";

const CODES = ["USD", "EUR", "GBP", "JPY", "CNY", "AUD", "CAD", "CHF", "SGD", "HKD", "KRW", "IDR", "MYR", "THB", "PHP", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "ZAR", "TRY", "BRL", "MXN", "ILS", "ISK", "RON"];
const RANGES: Record<string, number> = { "3M": 92, "6M": 183, "1Y": 365, "3Y": 1096, "5Y": 1827, Max: 1e6 };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PALETTE = ["--accent", "--warn", "--vsinr-up", "--vsinr-down"];
type Hist = { pair: string; source: string; sourceUrl: string; from: string; to: string; points: [string, number][] };
const cache = new Map<string, Promise<Hist>>();
const load = (c: string) => {
  if (!cache.has(c)) cache.set(c, fetch(`/api/pairhistory?code=${c}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; }));
  return cache.get(c)!;
};
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
const sgn = (v: number, d = 2) => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}` : "—");
function tone(v: number, step: number) {
  if (!Number.isFinite(v) || Math.abs(v) < step / 10) return "";
  return `vs-${v > 0 ? "up" : "down"} l${Math.abs(v) >= step ? 2 : 1}`;
}

function useThemeKey() {
  const [k, setK] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setK((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => mo.disconnect();
  }, []);
  return k;
}

type Line = { data: P[]; color: string; width?: number; title?: string };
function LWChart({ lines, height = 260, markers, themeKey, area }: { lines: Line[]; height?: number; markers?: SeriesMarker<Time>[]; themeKey: number; area?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ch: IChartApi = createChart(ref.current, {
      height, autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--mono") },
      grid: { vertLines: { color: css("--hairline") }, horzLines: { color: css("--hairline") } },
      rightPriceScale: { borderColor: css("--border") }, timeScale: { borderColor: css("--border") },
      crosshair: { mode: 0 },
    });
    lines.forEach((l, i) => {
      const s = area && i === 0
        ? ch.addAreaSeries({ lineColor: l.color, topColor: "transparent", bottomColor: l.color + "55", lineWidth: 1, invertFilledArea: true } as any)
        : ch.addLineSeries({ color: l.color, lineWidth: (l.width || 1) as any, title: l.title, priceLineVisible: false });
      s.setData(l.data.map((p) => ({ time: p.t as Time, value: p.v })));
      if (i === 0 && markers?.length) s.setMarkers(markers);
    });
    ch.timeScale().fitContent();
    return () => ch.remove();
  }, [lines, height, markers, themeKey, area]);
  return <div ref={ref} className="lw" style={{ height }} />;
}

function Histogram({ r }: { r: number[] }) {
  const m = mean(r), s = sd(r);
  const lo = m - 4 * s, hi = m + 4 * s, N = 40, w = (hi - lo) / N;
  const bins = Array(N).fill(0); r.forEach((x) => { const i = Math.min(N - 1, Math.max(0, Math.floor((x - lo) / w))); bins[i]++; });
  const mx = Math.max(...bins, 1), W = 600, H = 160;
  const X = (v: number) => ((v - lo) / (hi - lo)) * W;
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="hist-svg" preserveAspectRatio="none">
      {bins.map((b, i) => { const c = lo + (i + 0.5) * w; return <rect key={i} x={X(lo + i * w) + 1} width={W / N - 2} y={H - (b / mx) * H} height={(b / mx) * H} className={Math.abs(c - m) > 2 * s ? (c > m ? "hb up" : "hb down") : "hb"} />; })}
      {[-2, -1, 0, 1, 2].map((k) => (
        <g key={k}><line x1={X(m + k * s)} x2={X(m + k * s)} y1={0} y2={H} className={k ? "sig" : "sig zero"} /><text x={X(m + k * s)} y={H + 12} textAnchor="middle" className="sig-t">{k ? `${k > 0 ? "+" : ""}${k}σ` : "μ"}</text></g>
      ))}
    </svg>
  );
}

export function History() {
  const [sp, setSp] = useSearchParams();
  const themeKey = useThemeKey();
  const pair = (sp.get("pair") || "USD").toUpperCase();
  const range = sp.get("range") || "1Y";
  const cmp = (sp.get("cmp") || "").split(",").filter((c) => CODES.includes(c) && c !== pair).slice(0, 3);
  const corrWith = (sp.get("corr") || (pair === "EUR" ? "USD" : "EUR")).toUpperCase();
  const smaOn = (sp.get("sma") ?? "50,200").split(",").filter(Boolean).map(Number);
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); v == null || v === "" ? n.delete(k) : n.set(k, v); setSp(n, { replace: true }); };

  const [data, setData] = useState<Record<string, Hist>>({});
  const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState<any[]>([]);
  const need = useMemo(() => [...new Set([pair, corrWith, ...cmp])], [pair, corrWith, cmp.join()]);
  useEffect(() => {
    setErr(null);
    Promise.all(need.map(load)).then((hs) => setData((d) => ({ ...d, ...Object.fromEntries(hs.map((h, i) => [need[i], h])) }))).catch((e) => setErr(String(e.message || e)));
  }, [need.join()]);
  useEffect(() => { fetch("/data/calendar.json").then((r) => r.json()).then((j) => setCal(j.events || [])).catch(() => {}); }, []);

  const full: P[] = useMemo(() => (data[pair]?.points || []).map(([t, v]) => ({ t, v })), [data, pair]);
  const lastT = full.at(-1)?.t || "";
  const from = sp.get("from") || (lastT ? new Date(Date.parse(lastT) - (RANGES[range] ?? 365) * 864e5).toISOString().slice(0, 10) : "");
  const to = sp.get("to") || lastT;
  const clip = (s: P[]) => s.filter((p) => p.t >= from && p.t <= to);
  const view = useMemo(() => clip(full), [full, from, to]);

  const smaLines = useMemo(() => {
    const cols: Record<number, string> = { 20: css("--warn"), 50: css("--vsinr-up"), 200: css("--vsinr-down") };
    return smaOn.map((n) => ({ data: clip(sma(full, n)), color: cols[n], title: `SMA${n}` }));
  }, [full, from, to, smaOn.join(), themeKey]);
  const priceLines: Line[] = useMemo(() => [{ data: view, color: css("--text"), width: 2, title: pair + "INR" }, ...smaLines], [view, smaLines, themeKey]);
  const markers = useMemo(() => cal.filter((e) => e.date >= from && e.date <= to && view.some((p) => p.t >= e.date))
    .map((e) => ({ time: (view.find((p) => p.t >= e.date)!.t) as Time, position: "aboveBar" as const, color: css("--muted"), shape: "arrowDown" as const, text: e.kind.toUpperCase() })), [cal, view, themeKey]);

  const overlay: Line[] = useMemo(() => {
    if (!cmp.length) return [];
    const base = (s: P[]) => (s.length ? s.map((p) => ({ t: p.t, v: (p.v / s[0].v) * 100 })) : []);
    return [pair, ...cmp].map((c, i) => ({ data: base(clip((data[c]?.points || []).map(([t, v]) => ({ t, v })))), color: css(PALETTE[i]), width: 1, title: c + "INR" }));
  }, [data, pair, cmp.join(), from, to, themeKey]);

  // stats: computed on full series then clipped, so rolling windows are warm at the left edge
  const vol = useMemo(() => clip(rollVol(full, 20)), [full, from, to]);
  const dd = useMemo(() => drawdown(view), [view]);
  const r = useMemo(() => rets(view).map((x) => x.r), [view]);
  const m = mean(r), s = sd(r);
  const n2 = r.filter((x) => Math.abs(x - m) > 2 * s).length;
  const mon = useMemo(() => monthly(view), [view]);
  const years = Object.keys(mon).sort().reverse();
  const monAvg = MON.map((_, i) => { const a = years.map((y) => mon[y][i]).filter((v) => v != null); return { avg: mean(a), n: a.length, up: a.filter((v) => v > 0).length }; });
  const dw = useMemo(() => dow(view), [view]);
  const corr = useMemo(() => corrWith !== pair && data[corrWith] ? clip(rollCorr(full, data[corrWith].points.map(([t, v]) => ({ t, v })), 60)) : [], [full, data, corrWith, from, to]);

  const csv = () => {
    const vm = new Map(vol.map((p) => [p.t, p.v])), dm = new Map(dd.series.map((p) => [p.t, p.v]));
    const rows = ["date,rate,ret_pct,vol20_ann_pct,drawdown_pct"];
    view.forEach((p, i) => rows.push([p.t, p.v, i ? ((p.v / view[i - 1].v - 1) * 100).toFixed(4) : "", vm.get(p.t)?.toFixed(3) ?? "", dm.get(p.t)?.toFixed(3) ?? ""].join(",")));
    rows.push(`# source: ${data[pair]?.source} ${data[pair]?.sourceUrl}`);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" })); a.download = `${pair}INR_${from}_${to}.csv`; a.click();
  };

  const h = data[pair];
  const srcLine = h ? <>Source: <a href={h.sourceUrl} target="_blank" rel="noreferrer">{h.source}</a> · available {h.from} → {h.to} · as-of {h.to}</> : "loading…";
  return (
    <div className="history">
      <header className="page-h">
        <h1>History</h1>
        <p className="lede">Explore how INR pairs behaved in the past. Every panel describes historical data only. Nothing here is a forecast or a trade signal.</p>
      </header>

      <section className="panel h-controls">
        <label>Pair <select value={pair} onChange={(e) => set("pair", e.target.value)}>{CODES.map((c) => <option key={c} value={c}>{c}INR</option>)}</select></label>
        <div className="seg">{Object.keys(RANGES).map((k) => <button key={k} className={!sp.get("from") && range === k ? "on" : ""} onClick={() => { const n = new URLSearchParams(sp); n.set("range", k); n.delete("from"); n.delete("to"); setSp(n, { replace: true }); }}>{k}</button>)}</div>
        <label>From <input type="date" value={from} min={h?.from} max={to} onChange={(e) => set("from", e.target.value)} /></label>
        <label>To <input type="date" value={to} min={from} max={h?.to} onChange={(e) => set("to", e.target.value)} /></label>
        <div className="seg">{[20, 50, 200].map((n) => <button key={n} className={smaOn.includes(n) ? "on" : ""} onClick={() => set("sma", (smaOn.includes(n) ? smaOn.filter((x) => x !== n) : [...smaOn, n]).sort((a, b) => a - b).join(",") || ",")}>SMA{n}</button>)}</div>
        <label>Compare <select value="" onChange={(e) => e.target.value && set("cmp", [...cmp, e.target.value].slice(0, 3).join(","))}><option value="">+ add pair (max 3)</option>{CODES.filter((c) => c !== pair && !cmp.includes(c)).map((c) => <option key={c} value={c}>{c}INR</option>)}</select></label>
        {cmp.map((c) => <button key={c} className="chip" onClick={() => set("cmp", cmp.filter((x) => x !== c).join(","))}>{c}INR ×</button>)}
        <button className="chip" onClick={csv} disabled={!view.length}>Download CSV</button>
      </section>
      {err && <div className="panel warn mono">History unavailable: {err}. Upstream (Frankfurter/ECB) may be down. Other pages are unaffected.</div>}

      <section className="panel">
        <div className="panel-h">{pair}INR daily reference rate <span className="meta">{view.length} obs · {from} → {to} · markers = events from the sourced calendar · {srcLine}</span></div>
        {view.length > 1 ? <LWChart lines={priceLines} height={340} markers={markers} themeKey={themeKey} /> : <div className="mono faint">— loading</div>}
        <p className="meta faint">A rising line means INR per unit of {pair} went up: {pair} gained against INR. Event markers start {cal[0]?.date || "—"}; the calendar does not go back further.</p>
      </section>

      {cmp.length > 0 && (
        <section className="panel">
          <div className="panel-h">Rebased comparison <span className="meta">each pair = 100 on {overlay[0]?.data[0]?.t || from} · {srcLine}</span></div>
          <LWChart lines={overlay} height={260} themeKey={themeKey} />
          <div className="legend-row mono">{overlay.map((l) => <span key={l.title}><i style={{ background: l.color }} />{l.title} {sgn((l.data.at(-1)?.v ?? NaN) - 100)}%</span>)}</div>
        </section>
      )}

      <div className="h-grid">
        <section className="panel">
          <div className="panel-h">Rolling 20-day realized vol <span className="meta">annualized σ of daily % changes ×√252 · latest {vol.at(-1)?.v.toFixed(2) ?? "—"}% · range avg {mean(vol.map((p) => p.v)).toFixed(2)}%</span></div>
          <LWChart lines={[{ data: vol, color: css("--accent") }]} height={200} themeKey={themeKey} />
        </section>
        <section className="panel">
          <div className="panel-h">Drawdown from peak <span className="meta">max {dd.max.toFixed(2)}% (peak {dd.peakT || "—"} → trough {dd.troughT || "—"}) · peak reset at range start</span></div>
          <LWChart lines={[{ data: dd.series, color: css("--vsinr-down") }]} height={200} themeKey={themeKey} />
        </section>
        <section className="panel">
          <div className="panel-h">Daily return distribution <span className="meta">{r.length} days · μ {sgn(m, 3)}% · σ {s.toFixed(3)}% · {n2} days beyond ±2σ ({r.length ? ((n2 / r.length) * 100).toFixed(1) : "—"}%; a normal curve would give ~4.6%)</span></div>
          {r.length > 10 ? <Histogram r={r} /> : <div className="mono faint">— not enough data</div>}
        </section>
        <section className="panel">
          <div className="panel-h">60-day rolling correlation <span className="meta">daily % changes, {pair}INR vs <select value={corrWith} onChange={(e) => set("corr", e.target.value)}>{CODES.filter((c) => c !== pair).map((c) => <option key={c} value={c}>{c}INR</option>)}</select> · latest {corr.at(-1)?.v.toFixed(2) ?? "—"}</span></div>
          {corr.length ? <LWChart lines={[{ data: corr, color: css("--accent") }]} height={200} themeKey={themeKey} /> : <div className="mono faint">— needs 60+ shared days</div>}
        </section>
      </div>

      <section className="panel">
        <div className="panel-h">Monthly returns and seasonality <span className="meta">month-end to month-end % change · green = {pair} up vs INR, red = {pair} down vs INR · partial first/last months included · {srcLine}</span></div>
        <div className="tbl-wrap">
          <table className="mon-tbl mono">
            <thead><tr><th>Year</th>{MON.map((x) => <th key={x}>{x}</th>)}<th>Year</th></tr></thead>
            <tbody>
              {years.map((y) => { const vals = Object.values(mon[y]); const yr = (vals.reduce((a, v) => a * (1 + v / 100), 1) - 1) * 100; return (
                <tr key={y}><th>{y}</th>{MON.map((_, i) => <td key={i} className={`heat-cell ${tone(mon[y][i], 1.5)}`}>{mon[y][i] != null ? sgn(mon[y][i], 1) : ""}</td>)}<td className={`heat-cell ${tone(yr, 5)}`}>{sgn(yr, 1)}</td></tr>); })}
            </tbody>
            <tfoot>
              <tr><th>Avg</th>{monAvg.map((a, i) => <td key={i} className={`heat-cell ${tone(a.avg, 1)}`}>{a.n ? sgn(a.avg, 2) : ""}</td>)}<td /></tr>
              <tr><th>Up</th>{monAvg.map((a, i) => <td key={i} className="faint">{a.n ? `${a.up}/${a.n}` : ""}</td>)}<td /></tr>
            </tfoot>
          </table>
        </div>
        <div className="dow-row mono"><span className="faint">Day-of-week avg daily %:</span>{["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => <span key={d} className={tone(dw[i].avg * 20, 1)}>{d} {sgn(dw[i].avg, 3)} <span className="faint">(n={dw[i].n})</span></span>)}</div>
        <p className="meta faint">Averages over few years are noisy. They describe the past, not what comes next.</p>
      </section>
    </div>
  );
}
