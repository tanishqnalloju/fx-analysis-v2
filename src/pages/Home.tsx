import { Link } from "react-router-dom";
import { StatusTicker } from "../components/StatusTicker";
import { FxPct } from "../components/Pct";
import { asOfDate, findFx, formatRate } from "../lib/format";
import { useSnapshot } from "../lib/SnapshotContext";

export function Home() {
  const { snap, loading, error, strength, homeVerdict, regime, reload } = useSnapshot();

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
  const label = (strength?.label || "MIXED").toLowerCase() as "stronger" | "weaker" | "mixed";
  const asOf = asOfDate(snap);
  const shock = regime?.shock ? "Shock" : "Calm";

  const destinations = [
    {
      path: "/desk",
      job: "Full board — KPIs, majors, peers, import costs, yields",
      prev: `USDINR ${formatRate(usd?.rate)} · ${shock}`,
    },
    {
      path: "/compare/USD",
      job: "Relative strength vs key basket via INR bridge",
      prev: "Default USD",
    },
    {
      path: "/slip",
      job: "If INR slips vs USD, does it slip everywhere?",
      prev: "Key basket matrix",
    },
    {
      path: "/how",
      job: "Methodology, sources, quote convention, assumptions",
      prev: `${(snap.assumptions || []).length} assumptions`,
    },
    {
      path: `/notes/${asOf !== "—" ? asOf : "today"}`,
      job: "Daily takeaway from this snapshot only",
      prev: asOf,
    },
  ];

  return (
    <>
      <StatusTicker />
      <div className="home-grid">
        <aside className="verdict-rail">
          <div className="verdict-kicker">Today’s desk read</div>
          <div className={`verdict-word ${label}`}>{strength?.label || "MIXED"}</div>
          <p className="verdict-reason">{homeVerdict?.sentence1 || strength?.sentence1}</p>
          <p className="verdict-reason">{homeVerdict?.sentence2 || strength?.sentence2}</p>
          <div className="quote-box">
            <div className="qh">Quote convention</div>
            <p>
              Rates are <strong>INR per 1 foreign</strong> (e.g. USDINR).{" "}
              <strong>Higher XXXINR = weaker INR</strong> in FX terms. No buy/sell language.
            </p>
          </div>
        </aside>
        <div className="home-main">
          <div className="home-lede">
            <h1 className="home-question">
              Is the rupee weak only against the dollar, or more broadly?
            </h1>
            <p>
              Snapshot-only research desk. Board numbers come from shared KV (or baked fallback).
              Never invents prices, REER, or Δ%. Empties show —.
            </p>
          </div>
          <div className="meta-blotter">
            <div className="mc">
              <div className="lab">USDINR</div>
              <div className="val">{formatRate(usd?.rate)}</div>
              <div className="sub">INR per 1 USD</div>
            </div>
            <div className="mc">
              <div className="lab">Session Δ</div>
              <div className="val">
                <FxPct value={usd?.changePct} />
              </div>
              <div className="sub">Up = weaker INR</div>
            </div>
            <div className="mc">
              <div className="lab">Shock</div>
              <div className="val">{shock}</div>
              <div className="sub">{regime?.shockDetail || "—"}</div>
            </div>
            <div className="mc">
              <div className="lab">As-of</div>
              <div className="val">{asOf}</div>
              <div className="sub">{snap.dataSource || "—"}</div>
            </div>
          </div>
          <div className="dest-block">
            <div className="dest-head">Destinations</div>
            <ul className="dest-list">
              {destinations.map((d) => (
                <li key={d.path}>
                  <Link to={d.path}>
                    <span className="path">{d.path}</span>
                    <span className="job">{d.job}</span>
                    <span className="prev">{d.prev}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
