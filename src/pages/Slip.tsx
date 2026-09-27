import { Link } from "react-router-dom";
import { StatusTicker } from "../components/StatusTicker";
import { StrengthPct } from "../components/Pct";
import { useSnapshot } from "../lib/SnapshotContext";

export function Slip() {
  const { snap, loading, error, slip, reload } = useSnapshot();

  if (loading) {
    return (
      <>
        <StatusTicker />
        <div className="skel-block" />
      </>
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

  const rows = slip?.matrix?.rows || [];
  const cols = ["usd", "peers", "gold", "oil", "btc"] as const;

  return (
    <>
      <StatusTicker />
      <div className="page-head">
        <h1>Everywhere?</h1>
        <p className="muted">
          If INR slips vs USD, does it also slip vs peers / gold / oil / BTC? Scores from snapshot
          (+ history when present). Positive = firmer / strengthened.
        </p>
      </div>

      <div className="slip-row">
        <span className="slabel">INR</span>
        <span className="flag">{slip?.line || "—"}</span>
      </div>

      {slip?.narrative && <p className="compare-narr muted">{slip.narrative}</p>}

      <section className="panel full">
        <div className="panel-h">
          Slip matrix <span className="meta">{slip?.historyLabel || "key basket"}</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.code}>
                <td>
                  <Link to={`/compare/${r.code}`}>{r.code}</Link>
                </td>
                {cols.map((c) => (
                  <td key={c}>
                    <StrengthPct value={r.cells?.[c]} />
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="empty">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
