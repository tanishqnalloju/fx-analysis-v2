import { StatusTicker } from "../components/StatusTicker";
import { ColorLegend } from "../components/ColorLegend";
import { useSnapshot } from "../lib/SnapshotContext";

export function How() {
  const { snap, health } = useSnapshot();

  return (
    <>
      <StatusTicker />
      <div className="page-head">
        <h1>How this desk works</h1>
        <p className="muted">
          Methodology for FX Analysis v2 — a read-only consumer of the same KV snapshot that powers
          v1. No cron on this Worker.
        </p>
      </div>
      <ColorLegend />

      <section className="how-block">
        <h2>Quote convention</h2>
        <p>
          All FX prints are <strong>INR per 1 foreign unit</strong> (USDINR, EURINR, …). A{" "}
          <strong>higher</strong> XXXINR means a <strong>weaker</strong> rupee in FX terms. Session
          Δ% up therefore colors coral (weaker); Δ% down colors teal (stronger). Relative-strength /
          slip scores use the opposite polarity: up = strengthened (teal).
        </p>
      </section>

      <section className="how-block">
        <h2>Data path</h2>
        <ul className="mono how-list">
          <li>Worker service: fx-analysis-v2 (this host)</li>
          <li>KV binding DATA — shared with v1 · read only here</li>
          <li>Keys: snapshot · history · meta</li>
          <li>Fallback: baked /data/*.json in assets</li>
          <li>
            Live health: {health?.service || "—"} · asOf {(health?.asOf || snap?.asOf || "").slice(0, 10) || "—"} ·{" "}
            {health?.dataSource || snap?.dataSource || "—"}
          </li>
          <li>Refresh / cron: owned by v1 only</li>
        </ul>
      </section>

      <section className="how-block">
        <h2>Assumptions</h2>
        <ul className="how-list">
          {(snap?.assumptions || []).map((a, i) => (
            <li key={i}>{a}</li>
          ))}
          {!(snap?.assumptions || []).length && <li className="faint">—</li>}
        </ul>
      </section>

      <section className="how-block">
        <h2>Scriptures / integrity</h2>
        <ul className="how-list">
          {(snap?.scriptures || []).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          {!(snap?.scriptures || []).length && (
            <>
              <li>Never invent prices, REER, or Δ%.</li>
              <li>Honest empties show —.</li>
              <li>No buy/sell language on consumer surfaces.</li>
              <li>REER panel stays hidden until a sourced feed exists.</li>
            </>
          )}
        </ul>
      </section>

      <section className="how-block">
        <h2>Providers</h2>
        <p className="muted">
          Prefer Frankfurter/ECB reference FX. FloatRates extras are flagged and must not be
          presented as ECB. Gold/oil USD prints may be carried from prior sessions; BTC via Coinbase
          when available. Desk FX basket is RBI ETCD INR pairs plus a short India-relevant add-on
          list — not the full Frankfurter universe.
        </p>
      </section>
    </>
  );
}
