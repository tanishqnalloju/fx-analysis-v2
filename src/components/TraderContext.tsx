import { useEffect, useState } from "react";
import { formatPct, formatRate, vsInrTone } from "../lib/format";
import { rangeContext, unusualToday, type Pt } from "../lib/context";

const tone = (v: number | null | undefined) => {
  const t = vsInrTone(v);
  return t.dir === "flat" ? "" : `vs-${t.dir}`;
};
const f1 = (v: number | null | undefined, suf = "") =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(0)}${suf}`;
const sp = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

export function UnusualStrip({ fx, series, asOf, source }: { fx: any[]; series?: Record<string, Pt[]>; asOf: string; source?: string }) {
  const rows = unusualToday(fx, series, 5);
  return (
    <section className="panel unusual">
      <div className="panel-h">
        Unusual today{" "}
        <span className="meta">
          session Δ% ÷ own realized daily σ ({rows[0]?.obs ?? "—"} obs, stored history) · as-of {asOf} · {source || "—"}
        </span>
      </div>
      <div className="unusual-row">
        {rows.map((r) => (
          <div key={r.pair} className="u-cell">
            <span className="pair">{r.pair}</span>
            <span className={`mono ${tone(r.chg)}`}>{formatPct(r.chg)}</span>
            <span className={`mono z ${tone(r.chg)}`}>z {r.z > 0 ? "+" : ""}{r.z.toFixed(1)}</span>
            <span className="mono faint">σ {r.vol.toFixed(2)}%</span>
          </div>
        ))}
        {!rows.length && <span className="mono faint">— insufficient history</span>}
      </div>
    </section>
  );
}

const PAIRS = ["USDINR", "EURINR", "GBPINR", "JPYINR", "CNYINR", "AUDINR", "SGDINR", "CHFINR", "CADINR", "KRWINR"];

export function RangeContext() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/longhistory").then((r) => r.json()).then((j) => (j.series ? setD(j) : setErr(j.error || "unavailable"))).catch((e) => setErr(String(e)));
  }, []);
  return (
    <section className="panel">
      <div className="panel-h">
        Range context — levels for context, not signals{" "}
        <span className="meta">
          {d ? `as-of ${d.to} · ${d.source}` : err ? `unavailable: ${err}` : "loading…"}
        </span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Pair</th><th className="r">Close</th><th className="r">ATR14*</th><th className="r">ATR %</th>
            <th className="r">Pos 20d</th><th className="r">60d</th><th className="r">250d</th>
            <th className="r">vs 52w hi</th><th className="r">vs 52w lo</th><th className="r">vs SMA50</th><th className="r">vs SMA200</th>
          </tr>
        </thead>
        <tbody>
          {PAIRS.map((p) => {
            const c = rangeContext(d?.series?.[p]);
            if (!c) return null;
            return (
              <tr key={p}>
                <td className="pair">{p}</td>
                <td className="r mono">{formatRate(c.last)}</td>
                <td className="r mono">{c.atr.toPrecision(3)}</td>
                <td className="r mono">{c.atrPct.toFixed(2)}%</td>
                <td className="r mono">{f1(c.p20, "%")}</td>
                <td className="r mono">{f1(c.p60, "%")}</td>
                <td className="r mono">{f1(c.p250, "%")}</td>
                <td className="r mono">{sp(c.toHi)}</td>
                <td className="r mono">{sp(c.toLo)}</td>
                <td className="r mono">{sp(c.toS50)}</td>
                <td className="r mono">{sp(c.toS200)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mono faint foot">
        *ATR14 = mean |close-to-close Δ| over 14 sessions (proxy — ECB reference rates have no OHLC). Pos = where close sits in the N-day low→high range (0% = low, 100% = high). 52w = last 252 ECB fixings. INR per 1 foreign.
      </div>
    </section>
  );
}

const KIND: Record<string, string> = { rbi: "RBI", fomc: "FOMC", incpi: "IN CPI", uscpi: "US CPI", nfp: "NFP" };

export function EventCalendar({ series }: { series?: Record<string, Pt[]> }) {
  const [cal, setCal] = useState<any>(null);
  useEffect(() => {
    fetch("/data/calendar.json").then((r) => r.json()).then(setCal).catch(() => setCal({ events: [] }));
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const usd = series?.USDINR || [];
  const moveAfter = (date: string) => {
    const i = usd.findIndex((p) => p.t >= date);
    if (i <= 0 || i + 1 >= usd.length) return null;
    return (usd[Math.min(i + 1, usd.length - 1)].v / usd[i - 1].v - 1) * 100;
  };
  return (
    <section className="panel">
      <div className="panel-h">
        Event calendar <span className="meta">{cal?.label || "—"} · updated {cal?.updated || "—"}</span>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Event</th><th className="r">USDINR Δ (t−1→t+1)</th><th>Source</th></tr>
        </thead>
        <tbody>
          {(cal?.events || []).map((e: any) => {
            const past = e.date < today;
            const m = past ? moveAfter(e.date) : null;
            return (
              <tr key={e.date + e.kind} className={past ? "faint" : ""}>
                <td className="mono">{e.date}{e.date === today ? " · today" : ""}</td>
                <td className="mono">{KIND[e.kind] || e.kind}</td>
                <td>{e.label}</td>
                <td className={`r mono ${tone(m)}`}>{past ? (m == null ? "—" : formatPct(m)) : "upcoming"}</td>
                <td className="mono"><a href={e.source} target="_blank" rel="noreferrer">{new URL(e.source).hostname.replace("www.", "")}</a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mono faint foot">
        RBI weekly FX reserves not shown: RBI's Weekly Statistical Supplement has no stable machine-readable endpoint we can fetch reliably, so it's skipped rather than approximated.
      </div>
    </section>
  );
}
