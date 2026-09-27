import { StatusTicker } from "../components/StatusTicker";
import { ColorLegend } from "../components/ColorLegend";
import { FxPct } from "../components/Pct";
import { asOfDate, chgTone, findFx, findHard, formatInr, formatPct, formatRate } from "../lib/format";
import { useSnapshot } from "../lib/SnapshotContext";
import { deskFxWithAsia } from "../lib/takeaway";

function heatClass(chg: number | null | undefined) {
  if (chg == null || !Number.isFinite(chg)) return "z";
  if (chg <= -0.35) return "n2";
  if (chg < -0.05) return "n1";
  if (chg < 0.05) return "z";
  if (chg < 0.35) return "p1";
  return "p2";
}

function DivBar({ pair, chg }: { pair: string; chg: number | null }) {
  const max = 0.8;
  const v = chg == null || !Number.isFinite(chg) ? null : chg;
  const pct = v == null ? 0 : Math.min(50, (Math.abs(v) / max) * 50);
  const tone = chgTone(v);
  return (
    <div className="div-row">
      <span className="pair">{pair.replace("INR", "")}</span>
      <div className="div-track">
        {v != null && v !== 0 && (
          <div
            className={`div-bar ${v > 0 ? "pos" : "neg"}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className={`div-pct ${tone === "weaker" ? "pos" : tone === "stronger" ? "neg" : ""}`}>
        {formatPct(v)}
      </span>
    </div>
  );
}

function Spark({ series, tone }: { series: Array<{ t: string; v: number }> | undefined; tone: string }) {
  if (!series || series.length < 2) {
    return <span className="spark-note">NO SERIES</span>;
  }
  const vals = series.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 120;
  const h = 28;
  const pts = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const cls =
    tone === "weaker" ? "spark-weaker" : tone === "stronger" ? "spark-stronger" : "spark-muted";
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline className={cls} points={pts} strokeWidth="1.25" />
    </svg>
  );
}

export function Desk() {
  const { snap, history, loading, error, regime, slip, daily, reload } = useSnapshot();

  if (loading) {
    return (
      <div className="page-skel">
        <StatusTicker />
        <div className="skel-block" />
      </div>
    );
  }
  if (error || !snap) {
    return (
      <div className="error-box">
        <p className="mono">{error || "Snapshot unavailable"}</p>
        <button type="button" className="theme-btn" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  const usd = findFx(snap.fx, "USDINR");
  const gold = findHard(snap.hardAssets, "XAU");
  const brent = findHard(snap.hardAssets, "BRENT");
  const { all: deskFx } = deskFxWithAsia(snap.fx);
  const asOf = asOfDate(snap);
  const shock = regime?.shock ? "Shock" : "Calm";

  const flags = [];
  const cells = slip?.cells;
  if (cells) {
    const mk = (id: string, label: string) => {
      const v = (cells as any)[id];
      if (v == null || !Number.isFinite(v)) return { label, kind: "watch" as const };
      if (v <= -0.05) return { label: `${label} soft`, kind: "slip" as const };
      if (v >= 0.05) return { label: `${label} firm`, kind: "ok" as const };
      return { label: `${label} flat`, kind: "ok" as const };
    };
    flags.push(mk("usd", "vs USD"), mk("peers", "peers"), mk("gold", "gold"), mk("oil", "oil"));
  }

  const peerHeat = deskFx.slice(0, 12);

  return (
    <>
      <div className="desk-title">
        <h1>INR research desk</h1>
        <span className="asof">as-of {asOf} · {snap.dataSource || "—"}</span>
      </div>
      <StatusTicker />
      <ColorLegend />

      <div className="kpi-strip">
        <div className="kpi primary">
          <div className="lab">USDINR</div>
          <div className="val">{formatRate(usd?.rate)}</div>
          <div className="delta">
            <FxPct value={usd?.changePct} />
          </div>
          <Spark series={history?.series?.USDINR} tone={chgTone(usd?.changePct)} />
        </div>
        <div className="kpi">
          <div className="lab">Gold INR/oz</div>
          <div className="val">{formatInr(gold?.inrPrice, { compact: false })}</div>
          <div className="delta">
            <FxPct value={gold?.changePct ?? null} />
          </div>
          <span className="spark-note">{gold?.changePct == null ? "Δ UNAVAILABLE" : "SESSION"}</span>
        </div>
        <div className="kpi">
          <div className="lab">Brent INR/bbl</div>
          <div className="val">{formatInr(brent?.inrPrice, { compact: false })}</div>
          <div className="delta">
            <FxPct value={brent?.changePct ?? null} />
          </div>
          <span className="spark-note">{brent?.changePct == null ? "Δ UNAVAILABLE" : "SESSION"}</span>
        </div>
        <div className="kpi">
          <div className="lab">Shock</div>
          <div className="val">{shock}</div>
          <div className="delta mono faint">{regime?.shockDetail || "—"}</div>
        </div>
        <div className="kpi">
          <div className="lab">Breadth</div>
          <div className="val">{regime?.breadthPct != null ? `${regime.breadthPct}%` : "—"}</div>
          <div className="delta mono muted">{regime?.breadthLabel || "—"}</div>
        </div>
      </div>

      <div className="slip-row">
        <span className="slabel">Slip</span>
        {flags.length ? (
          flags.map((f) => (
            <span key={f.label} className={`flag ${f.kind}`}>
              {f.label}
            </span>
          ))
        ) : (
          <span className="flag">{slip?.line || "—"}</span>
        )}
      </div>

      <div className="blotter-2">
        <section className="panel">
          <div className="panel-h">
            Majors session Δ <span className="meta">left = stronger INR · right = weaker</span>
          </div>
          <div className="div-list">
            {deskFx.map((row: any) => (
              <DivBar key={row.pair} pair={row.pair} chg={row.changePct} />
            ))}
            {!deskFx.length && <div className="empty-pad mono faint">—</div>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h">
            Peer heatmap <span className="meta">session Δ%</span>
          </div>
          <div className="heat-wrap">
            <div className="heat-grid">
              {peerHeat.map((row: any) => (
                <div
                  key={row.pair}
                  className={`heat-cell ${heatClass(row.changePct)}`}
                  title={`${row.pair} ${formatPct(row.changePct)}`}
                >
                  <span className="c">{String(row.pair).replace("INR", "")}</span>
                  <span className="d">{formatPct(row.changePct)}</span>
                </div>
              ))}
              {!peerHeat.length && <span className="mono faint">—</span>}
            </div>
          </div>
        </section>
      </div>

      <div className="blotter-2">
        <section className="panel">
          <div className="panel-h">Import costs (INR)</div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Asset</th>
                <th>INR</th>
                <th>Δ%</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(snap.hardAssets || []).slice(0, 8).map((h) => (
                <tr key={h.id}>
                  <td>{h.name || h.id}</td>
                  <td>{formatInr(h.inrPrice, { compact: false })}</td>
                  <td>
                    <FxPct value={h.changePct ?? null} />
                  </td>
                  <td className="faint">{h.changePct == null ? "carried / —" : h.unit || "—"}</td>
                </tr>
              ))}
              {!(snap.hardAssets || []).length && (
                <tr>
                  <td colSpan={4} className="empty">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <div className="panel-h">
            UST yields <span className="meta">{snap.yields?.asOf || "—"}</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Tenor</th>
                <th>Yield</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>US 2Y</td>
                <td className="mono">
                  {snap.yields?.us2y != null ? `${Number(snap.yields.us2y).toFixed(2)}%` : "—"}
                </td>
              </tr>
              <tr>
                <td>US 10Y</td>
                <td className="mono">
                  {snap.yields?.us10y != null ? `${Number(snap.yields.us10y).toFixed(2)}%` : "—"}
                </td>
              </tr>
              <tr>
                <td>10Y−2Y</td>
                <td className="mono">
                  {snap.yields?.us10yMinus2y != null
                    ? `${Number(snap.yields.us10yMinus2y).toFixed(2)} pp`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <div className="takeaway-line">
        <span className="tl-label">Takeaway</span>
        <span className="tl-body mono">
          {(daily?.lines || []).slice(0, 3).join(" · ") || "—"}
        </span>
      </div>

      <details className="research-drawer">
        <summary>Research packs</summary>
        <div className="research-body">
          <p className="mono muted">{snap.realStrength?.summary || "No real-strength summary in snapshot."}</p>
          <ul>
            {(snap.realStrength?.legs || []).map((leg, i) => (
              <li key={i} className="mono">
                <strong>{leg.lens}</strong> · {leg.verdict}
                {leg.detail ? ` — ${leg.detail}` : ""}
              </li>
            ))}
            {!(snap.realStrength?.legs || []).length && <li className="faint">—</li>}
          </ul>
        </div>
      </details>
    </>
  );
}
