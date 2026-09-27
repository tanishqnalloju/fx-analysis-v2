import { DESK_FX_BASKET_IDS, filterDeskFxRows, buildSlipMatrix } from "../domain/compare-lib.js";
import type { History, Snapshot } from "./api";
import type { Regime } from "./regime";
import { findFx, findHard, formatPct } from "./format";

export const ASIA_PEER_IDS = ["KRW", "TWD", "IDR", "VND", "THB"];
export const SITE_ORIGIN = "https://v2.fx-analysis.tanishqnalloju.com";

export function buildRealStrengthBlurb(snap: Snapshot, regime: Regime | null) {
  const usd = findFx(snap.fx, "USDINR");
  const gold = findHard(snap.hardAssets, "XAU");
  const brent = findHard(snap.hardAssets, "BRENT");
  const rate = usd?.rate;
  const chg = usd?.changePct;
  const soft = typeof chg === "number" ? chg > 0 : null;
  const breadth = regime?.breadthLabel || null;
  const shock = regime?.shock;

  let label: "STRONGER" | "WEAKER" | "MIXED" = "MIXED";
  if (soft === true && (breadth === "usd-aligned" || breadth === "mixed")) label = "WEAKER";
  else if (soft === false) label = "STRONGER";
  else if (soft === true) label = "WEAKER";

  const legs = snap.realStrength?.legs || [];
  const weakerN = legs.filter((l) => String(l.verdict || "").toLowerCase() === "weaker").length;
  const strongerN = legs.filter((l) => String(l.verdict || "").toLowerCase() === "stronger").length;
  if (weakerN > strongerN + 1) label = "WEAKER";
  else if (strongerN > weakerN + 1) label = "STRONGER";
  else if (weakerN && strongerN) label = "MIXED";

  const asOf = (snap.asOf || "").slice(0, 10) || "—";
  const chgTxt = typeof chg === "number" ? `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%` : "—";
  const sentence1 = `On ${asOf}, USDINR printed ${
    rate != null ? Number(rate).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "—"
  } (${chgTxt} session) — ${
    soft === true
      ? "a softer INR vs the dollar"
      : soft === false
        ? "a firmer INR vs the dollar"
        : "INR vs USD move unavailable"
  }${shock ? ", on a Shock day" : ", on a Calm day"}.`;

  const goldTxt =
    gold?.inrPrice != null
      ? `Gold cost about ₹${Number(gold.inrPrice).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/oz`
      : "Gold INR print unavailable";
  const oilTxt =
    brent?.inrPrice != null
      ? `Brent about ₹${Number(brent.inrPrice).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/bbl`
      : "Brent INR print unavailable";
  const breadthTxt =
    regime?.breadthPct != null
      ? `Desk breadth was ${regime.breadthLabel || "mixed"} versus USDINR`
      : "Desk breadth unavailable";
  const sentence2 = `${goldTxt}; ${oilTxt}. ${breadthTxt} — research commentary only, not an RBI REER.`;

  return { label, sentence1, sentence2, asOf };
}

export function buildSlipSummaryFlags(snap: Snapshot, history: History | null) {
  const matrix = buildSlipMatrix(snap, history, { keyBasketOnly: true });
  const inr = (matrix.rows || []).find((r: any) => r.code === "INR");
  const lineParts: string[] = [];
  if (inr?.cells) {
    const c = inr.cells;
    const bit = (id: string, label: string) => {
      if (c[id] == null || !Number.isFinite(c[id])) return null;
      const v = c[id];
      const dir = v <= -0.05 ? "soft" : v >= 0.05 ? "firm" : "flat";
      return `${label} ${dir}`;
    };
    for (const [id, label] of [
      ["usd", "vs USD"],
      ["peers", "peers"],
      ["gold", "gold"],
      ["oil", "oil"],
      ["btc", "btc"],
    ] as const) {
      const b = bit(id, label);
      if (b) lineParts.push(b);
    }
  }
  return {
    flags: inr?.flags || [],
    line: lineParts.length ? lineParts.join(" · ") : "Slip scores unavailable for INR this session",
    cells: inr?.cells || null,
    historyLabel: matrix.historyLabel || "",
    narrative: matrix.narrative || "",
    matrix,
  };
}

export function buildHomeVerdict(snap: Snapshot, regime: Regime | null, strength: { label: string }) {
  const usd = findFx(snap.fx, "USDINR");
  const asOf = (snap.asOf || "").slice(0, 10);
  const soft = typeof usd?.changePct === "number" ? usd.changePct > 0 : null;
  const shock = regime?.shock ? "Shock" : "Calm";
  const label = strength?.label || "MIXED";
  const s1 =
    soft == null
      ? `Session snapshot for ${asOf}: USDINR ${usd?.rate ?? "—"} · ${shock}.`
      : soft
        ? `Session snapshot for ${asOf}: USDINR ${Number(usd!.rate).toLocaleString("en-IN", { maximumFractionDigits: 4 })} rose ${formatPct(usd!.changePct)} — INR softer vs the dollar (${shock}).`
        : `Session snapshot for ${asOf}: USDINR ${Number(usd!.rate).toLocaleString("en-IN", { maximumFractionDigits: 4 })} eased ${formatPct(usd!.changePct)} — INR firmer vs the dollar (${shock}).`;
  const s2 = `Desk read: ${label}. Quotes are INR per 1 foreign unit; a higher USDINR means a weaker rupee.`;
  return { sentence1: s1, sentence2: s2, label, asOf, shock };
}

export function buildDailyTakeaway(
  snap: Snapshot,
  _history: History | null,
  regime: Regime | null,
  slipSummary: ReturnType<typeof buildSlipSummaryFlags> | null
) {
  const asOfDate = (snap.asOf || "").slice(0, 10) || "—";
  const usd = findFx(snap.fx, "USDINR");
  const gold = findHard(snap.hardAssets, "XAU");
  const brent = findHard(snap.hardAssets, "BRENT");
  const shockLabel = regime?.shock ? "Shock" : "Calm";
  const cells = slipSummary?.cells || {};
  const slipBit = (id: string) => {
    const v = (cells as any)[id];
    if (v == null || !Number.isFinite(v)) return "—";
    if (v <= -0.05) return "soft";
    if (v >= 0.05) return "firm";
    return "flat";
  };
  let sameSign = 0;
  let peerN = 0;
  const usdChg = usd?.changePct;
  for (const code of DESK_FX_BASKET_IDS) {
    if (code === "USD") continue;
    const row = findFx(snap.fx, `${code}INR`);
    const chg = row?.changePct;
    if (typeof chg !== "number" || typeof usdChg !== "number") continue;
    peerN += 1;
    if (chg === 0 || usdChg === 0) continue;
    if (Math.sign(chg) === Math.sign(usdChg)) sameSign += 1;
  }
  const breadthAlign =
    peerN === 0
      ? "—"
      : sameSign / peerN >= 0.6
        ? "usd-aligned"
        : sameSign / peerN <= 0.4
          ? "diverging"
          : "mixed";
  const rateTxt =
    usd?.rate != null
      ? Number(usd.rate).toLocaleString("en-IN", { maximumFractionDigits: 4 })
      : "—";
  const fmtInrPlain = (n: number | null | undefined, digits = 0) => {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
  };
  const lines = [
    `INR takeaway · ${asOfDate}`,
    `USDINR ${rateTxt} (${formatPct(usd?.changePct)}) · ${shockLabel}`,
    `Breadth: ${sameSign}/${peerN} desk peers same sign as USDINR (${breadthAlign})`,
    `Slip vs USD: ${slipBit("usd")} · peers ${slipBit("peers")} · gold ${slipBit("gold")} · oil ${slipBit("oil")} · btc ${slipBit("btc")}`,
    `Gold ${fmtInrPlain(gold?.inrPrice, 0)}/oz · Brent ${fmtInrPlain(brent?.inrPrice, 0)}/bbl`,
    `Research commentary only — not RBI REER. ${SITE_ORIGIN}/desk`,
  ];
  return { asOfDate, lines, text: lines.join("\n"), shockLabel, breadthAlign };
}

export function deskFxWithAsia(fx: Snapshot["fx"]) {
  const core = filterDeskFxRows(fx);
  const byPair = new Map((fx || []).map((r) => [String(r.pair).toUpperCase(), r]));
  const asia = ASIA_PEER_IDS.map((c) => byPair.get(`${c}INR`)).filter(Boolean) as any[];
  const seen = new Set(core.map((r: any) => r.pair));
  const extra = asia.filter((r) => !seen.has(r.pair));
  return { core, asia: extra, all: [...core, ...extra] };
}
