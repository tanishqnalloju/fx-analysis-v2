import { asOfDate } from "../lib/format";
import { useSnapshot } from "../lib/SnapshotContext";

function lagDays(asOf: string): number | null {
  if (!asOf || asOf === "—") return null;
  try {
    const a = Date.parse(asOf.slice(0, 10) + "T00:00:00Z");
    const now = Date.now();
    if (!Number.isFinite(a)) return null;
    return Math.max(0, Math.round((now - a) / 86400000));
  } catch {
    return null;
  }
}

export function StatusTicker() {
  const { snap, health, via } = useSnapshot();
  const asOf = asOfDate(snap) || (health?.asOf || "").slice(0, 10) || "—";
  const lag = lagDays(asOf);
  const stale = lag != null && lag >= 3;
  const source = snap?.dataSource || health?.dataSource || via || "—";
  const fxCount = snap?.fx?.length ?? health?.fxCount ?? "—";
  const lastRefresh = health?.lastRefresh
    ? new Date(health.lastRefresh).toISOString().replace("T", " ").slice(0, 19) + "Z"
    : "—";

  return (
    <div className="ticker" role="status" aria-live="polite">
      <div className="t-cell">
        <span className={`dot ${stale ? "stale" : ""}`} aria-hidden />
        <span className="t-label">Board</span>
        <span className={`val ${stale ? "stale" : ""}`}>
          {(source || "").toString().toUpperCase()}
        </span>
      </div>
      <div className="t-cell">
        <span className="t-label">As-of</span>
        <span className={`val ${stale ? "stale" : ""}`}>{asOf}</span>
      </div>
      <div className="t-cell">
        <span className="t-label">FX</span>
        <span className="val">{fxCount}</span>
      </div>
      <div className="t-cell">
        <span className="t-label">Refresh</span>
        <span className="val">{lastRefresh}</span>
      </div>
      <div className="t-cell">
        <span className="t-label">Lag</span>
        <span className={`val ${stale ? "stale" : ""}`}>
          {lag == null ? "—" : lag === 0 ? "0d" : `${lag}d`}
        </span>
      </div>
    </div>
  );
}
