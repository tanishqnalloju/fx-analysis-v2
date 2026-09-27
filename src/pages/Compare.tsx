import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { StatusTicker } from "../components/StatusTicker";
import { StrengthPct } from "../components/Pct";
import { loadCompare } from "../lib/api";
import { formatPct, formatRate } from "../lib/format";
import { useSnapshot } from "../lib/SnapshotContext";
import { listSelectableCodes, buildCompare } from "../domain/compare-lib.js";

export function Compare() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const { snap, loading } = useSnapshot();
  const code = (codeParam || "USD").toUpperCase();
  const [payload, setPayload] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        let data = await loadCompare(code);
        if ((!data || data.error) && snap) {
          data = buildCompare(snap, code);
        }
        if (cancelled) return;
        if (!data || data.error) {
          setErr(data?.error || "Compare unavailable");
          setPayload(data);
        } else {
          setPayload(data);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Compare failed");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, snap]);

  const selectable = payload?.selectable || (snap ? listSelectableCodes(snap) : []);

  if (loading && !snap) {
    return (
      <>
        <StatusTicker />
        <div className="skel-block" />
      </>
    );
  }

  return (
    <>
      <StatusTicker />
      <div className="page-head">
        <h1>Compare</h1>
        <p className="muted">
          Relative strength via INR bridge. Positive score = selected strengthened vs leg.
        </p>
      </div>

      <div className="compare-bar">
        <label className="mono faint" htmlFor="cmp-code">
          Code
        </label>
        <select
          id="cmp-code"
          className="theme-btn"
          value={code}
          onChange={(e) => navigate(`/compare/${e.target.value}`)}
        >
          {(selectable.length ? selectable : [code]).map((c: string) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="mono muted">
          as-of {payload?.asOf?.slice?.(0, 10) || "—"}
          {busy ? " · loading…" : ""}
        </span>
      </div>

      {err && !payload?.selected && (
        <div className="error-box">
          <p className="mono">{err}</p>
          <Link to="/compare/USD">Try USD</Link>
        </div>
      )}

      {payload?.selected && (
        <>
          <div className="meta-blotter compare-hero">
            <div className="mc">
              <div className="lab">Selected</div>
              <div className="val">{payload.code}</div>
              <div className="sub">{payload.unitLabel || payload.kind}</div>
            </div>
            <div className="mc">
              <div className="lab">INR / 1</div>
              <div className="val">{formatRate(payload.selected.inrPerUnit)}</div>
              <div className="sub">via snapshot</div>
            </div>
            <div className="mc">
              <div className="lab">Session Δ</div>
              <div className="val mono">{formatPct(payload.selected.changePct)}</div>
              <div className="sub">own print</div>
            </div>
            <div className="mc">
              <div className="lab">vs USD</div>
              <div className="val">{payload.kpi?.vsUsd?.value != null ? formatRate(payload.kpi.vsUsd.value) : "—"}</div>
              <div className="sub">{payload.kpi?.vsUsd?.unit || "—"}</div>
            </div>
          </div>

          {payload.narrative && (
            <p className="compare-narr muted">{payload.narrative}</p>
          )}

          <section className="panel full">
            <div className="panel-h">
              Ranking <span className="meta">Δ% selected − Δ% leg</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Leg</th>
                  <th>Kind</th>
                  <th>Strength</th>
                </tr>
              </thead>
              <tbody>
                {(payload.ranking || []).map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.label || r.id}</td>
                    <td className="faint">{r.kind}</td>
                    <td>
                      <StrengthPct value={r.score} />
                    </td>
                  </tr>
                ))}
                {!(payload.ranking || []).length && (
                  <tr>
                    <td colSpan={3} className="empty">
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="panel full" style={{ marginTop: 0, borderTop: 0 }}>
            <div className="panel-h">Legs</div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Leg</th>
                  <th>Per 1 selected</th>
                  <th>Selected per 1</th>
                  <th>Δ strength</th>
                </tr>
              </thead>
              <tbody>
                {(payload.legs || []).map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.label}</td>
                    <td className="mono">{l.unitsPerSelected ?? "—"}</td>
                    <td className="mono">{l.selectedPerUnit ?? "—"}</td>
                    <td>
                      <StrengthPct value={l.strengthScore} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
