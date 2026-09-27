import { DESK_FX_BASKET_IDS } from "../domain/compare-lib.js";
import type { History, Snapshot } from "./api";

function seriesValues(series: Array<{ t: string; v: number }> | undefined) {
  if (!Array.isArray(series)) return [];
  return series
    .filter((p) => p && typeof p.v === "number" && Number.isFinite(p.v))
    .slice()
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

function stdev(arr: number[]) {
  if (!arr.length) return null;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

export type Regime = {
  shock: boolean;
  shockDetail: string;
  breadthPct: number | null;
  breadthLabel: string | null;
  cards: Array<{ id: string; title: string; primary: string; secondary?: string; flag?: boolean }>;
};

/** Lightweight regime from snapshot + history — no invent. */
export function buildRegime(snap: Snapshot, history: History | null): Regime {
  const usdPts = seriesValues(history?.series?.USDINR);
  const usdVals = usdPts.map((p) => p.v);

  let shock = false;
  let shockDetail = "—";
  if (usdVals.length >= 22) {
    const rets: number[] = [];
    for (let i = 1; i < usdVals.length; i++) {
      rets.push((usdVals[i] - usdVals[i - 1]) / usdVals[i - 1]);
    }
    const trail = rets.slice(-21, -1);
    const lastRet = rets[rets.length - 1];
    const s = stdev(trail);
    if (s != null && s > 0) {
      shock = Math.abs(lastRet) > 2 * s;
      shockDetail = `|1d| ${(Math.abs(lastRet) * 100).toFixed(2)}% vs 2σ ${(2 * s * 100).toFixed(2)}%`;
    }
  }

  const usdRow = (snap.fx || []).find((r) => r.pair === "USDINR");
  const usdChg = usdRow?.changePct;
  let sameSign = 0;
  let peerN = 0;
  for (const code of DESK_FX_BASKET_IDS) {
    if (code === "USD") continue;
    const row = (snap.fx || []).find((r) => r.pair === `${code}INR`);
    const chg = row?.changePct;
    if (typeof chg !== "number" || typeof usdChg !== "number") continue;
    peerN += 1;
    if (chg === 0 || usdChg === 0) continue;
    if (Math.sign(chg) === Math.sign(usdChg)) sameSign += 1;
  }
  const breadthPct = peerN > 0 ? Number(((sameSign / peerN) * 100).toFixed(0)) : null;
  const breadthLabel =
    breadthPct == null
      ? null
      : breadthPct >= 60
        ? "usd-aligned"
        : breadthPct <= 40
          ? "diverging"
          : "mixed";

  return {
    shock,
    shockDetail,
    breadthPct,
    breadthLabel,
    cards: [
      {
        id: "shock",
        title: "USDINR shock flag",
        primary: shock ? "Shock" : "Calm",
        secondary: shockDetail,
        flag: shock,
      },
      {
        id: "breadth",
        title: "FX breadth vs USDINR",
        primary: breadthPct != null ? `${breadthPct}%` : "—",
        secondary: breadthLabel || "—",
      },
    ],
  };
}
