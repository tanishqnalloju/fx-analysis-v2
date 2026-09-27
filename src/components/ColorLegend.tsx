export function ColorLegend() {
  return (
    <div className="legend" aria-label="Color legend">
      <span className="sw">
        <i className="weaker" /> FX Δ% up = weaker INR
      </span>
      <span className="sw">
        <i className="stronger" /> FX Δ% down = stronger INR
      </span>
      <span className="sw">
        <i className="warn" /> Warn = stale / WATCH only
      </span>
      <span className="sw">
        <i className="accent" /> Accent = nav / focus
      </span>
      <span className="sw">
        <i className="heat" /> Heat = peer session Δ
      </span>
    </div>
  );
}
