import { Link, useParams } from "react-router-dom";
import { StatusTicker } from "../components/StatusTicker";
import { asOfDate } from "../lib/format";
import { useSnapshot } from "../lib/SnapshotContext";

export function Notes() {
  const { date } = useParams();
  const { snap, loading, daily } = useSnapshot();
  const board = asOfDate(snap);
  const mismatch = date && board !== "—" && date !== board && date !== "today";

  return (
    <>
      <StatusTicker />
      <div className="page-head">
        <h1>Daily note · {date || board}</h1>
        <p className="muted">
          Generated from the current snapshot only — no invented backfill.
        </p>
      </div>

      {mismatch && (
        <div className="warn-box mono">
          Requested date {date} ≠ board as-of {board}. Showing current snapshot takeaway.
        </div>
      )}

      {loading && <div className="skel-block" />}

      {!loading && (
        <pre className="note-pre mono">{daily?.text || "Takeaway unavailable."}</pre>
      )}

      <p className="muted">
        <Link to="/desk">Open desk</Link> · <Link to="/how">Methodology</Link>
      </p>
    </>
  );
}
