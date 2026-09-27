import { NavLink, Outlet } from "react-router-dom";
import { ThemeControl } from "./ThemeControl";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/desk", label: "Desk" },
  { to: "/compare", label: "Compare" },
  { to: "/slip", label: "Slip" },
  { to: "/how", label: "How" },
];

export function AppShell() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell">
        <div className="shell-inner">
          <div className="brand">
            FX ANALYSIS <em>v2</em>
          </div>
          <nav className="nav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="shell-right">
            <ThemeControl />
          </div>
        </div>
      </header>
      <main id="main" className="frame">
        <Outlet />
      </main>
      <footer className="site-foot mono faint">
        FX Analysis v2 · staging · read-only KV · research commentary, not advice ·{" "}
        <a href="https://fx-analysis.tanishqnalloju.com">v1 live</a>
      </footer>
    </>
  );
}
