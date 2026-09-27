/** Compare builder ported from v1 worker (read-only; no cron). */
function buildInrPerMap(snap) {
  const inrPer = { INR: 1 };
  for (const row of snap.fx || []) {
    if (!row?.pair || typeof row.rate !== "number" || !(row.rate > 0)) continue;
    const pair = String(row.pair).toUpperCase();
    if (pair.endsWith("INR") && pair.length > 3) {
      inrPer[pair.slice(0, -3)] = row.rate;
    }
  }
  return inrPer;
}

function listSelectableCodes(snap) {
  const inrPer = buildInrPerMap(snap);
  const codes = new Set(Object.keys(inrPer));
  for (const h of snap.hardAssets || []) {
    if (h?.id) codes.add(String(h.id).toUpperCase());
  }
  const maj = ["INR", "USD", "EUR", "GBP", "JPY", "CNY", "XAU", "BTC", "BRENT", "WTI"];
  return [...codes].sort((a, b) => {
    const ia = maj.indexOf(a);
    const ib = maj.indexOf(b);
    if (ia >= 0 || ib >= 0) {
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });
}

function findHard(snap, id) {
  const want = String(id).toUpperCase();
  return (snap.hardAssets || []).find((h) => String(h.id || "").toUpperCase() === want) || null;
}

function fxChangePct(snap, code) {
  if (code === "INR") return 0;
  const pair = `${code}INR`;
  const row = (snap.fx || []).find((r) => String(r.pair).toUpperCase() === pair);
  if (row && typeof row.changePct === "number" && Number.isFinite(row.changePct)) {
    return row.changePct;
  }
  return null;
}

function hardChangePct(h) {
  if (h && typeof h.changePct === "number" && Number.isFinite(h.changePct)) return h.changePct;
  return null;
}

function roundNice(n) {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs === 0) return 0;
  if (abs >= 1000) return Number(n.toFixed(2));
  if (abs >= 100) return Number(n.toFixed(3));
  if (abs >= 1) return Number(n.toFixed(6));
  if (abs >= 1e-4) return Number(n.toFixed(8));
  return Number(n.toPrecision(4));
}

function resolveSelected(snap, codeRaw) {
  const code = String(codeRaw || "").toUpperCase();
  if (!code) return null;
  const inrPer = buildInrPerMap(snap);
  if (inrPer[code] != null) {
    return {
      code,
      inrPerUnit: inrPer[code],
      unitLabel: code === "INR" ? "INR" : `1 ${code}`,
      kind: "fx",
      changePct: fxChangePct(snap, code),
    };
  }
  const hard = findHard(snap, code);
  if (hard && typeof hard.inrPrice === "number" && hard.inrPrice > 0) {
    const unit =
      code === "XAU"
        ? "oz gold"
        : code === "BRENT" || code === "WTI"
          ? "bbl"
          : code === "BTC"
            ? "BTC"
            : hard.unit || hard.name || code;
    return {
      code,
      inrPerUnit: hard.inrPrice,
      unitLabel: unit,
      kind: "hard",
      changePct: hardChangePct(hard),
      hard,
    };
  }
  return null;
}

function buildNarrative(selected, kpi, ranking, legs) {
  const code = selected.code;
  const parts = [];
  const vsUsd = ranking.find((r) => r.id === "USD");
  const vsGold = ranking.find((r) => r.id === "XAU");
  const vsBrent = ranking.find((r) => r.id === "BRENT");
  const vsWti = ranking.find((r) => r.id === "WTI");
  const peerIds = new Set(["EUR", "GBP", "JPY", "CNY", "INR"]);
  const peers = ranking.filter((r) => peerIds.has(r.id) && r.id !== code);
  const weakThresh = -0.05;
  const strongThresh = 0.05;
  const describe = (r) => {
    if (!r) return null;
    if (r.score <= weakThresh) return "weaker";
    if (r.score >= strongThresh) return "stronger";
    return "flat";
  };

  if (code === "USD") {
    parts.push("Selected is USD — USD-relative weakness is N/A; ranking is vs peers, gold, oil, BTC.");
  } else if (vsUsd) {
    parts.push(
      `Vs USD (session): ${code} looks ${describe(vsUsd)} (cross Δ% ≈ ${vsUsd.score.toFixed(2)}%).`
    );
  } else if (kpi.vsUsd) {
    parts.push(
      `Vs USD (level): 1 ${code} ≈ ${kpi.vsUsd.value} USD (no session Δ% for ranking).`
    );
  }

  const oilGold = [vsGold, vsBrent, vsWti].filter(Boolean);
  if (vsUsd && oilGold.length) {
    const usdWeak = (vsUsd.score ?? 0) <= weakThresh;
    const alsoWeak = oilGold.filter((r) => (r.score ?? 0) <= weakThresh);
    const alsoStrong = oilGold.filter((r) => (r.score ?? 0) >= strongThresh);
    if (usdWeak) {
      if (alsoWeak.length >= 1) {
        parts.push(
          `Weakness vs USD also shows vs ${alsoWeak.map((r) => r.label).join(", ")} — not purely USD-specific.`
        );
      } else if (alsoStrong.length >= 1) {
        parts.push(
          `Weak vs USD but stronger/flat vs ${alsoStrong.map((r) => r.label).join(", ")} — move looks more USD-specific (or commodity-led).`
        );
      } else {
        parts.push(
          `Weak vs USD; gold/oil ranking scores are near flat or unavailable — treat as mostly FX/USD-side.`
        );
      }
    } else {
      const weakHard = oilGold.filter((r) => (r.score ?? 0) <= weakThresh);
      if (weakHard.length) {
        parts.push(
          `Not broadly weak vs USD, but softer vs ${weakHard.map((r) => r.label).join(", ")} (commodity print).`
        );
      }
    }
  }

  if (peers.length) {
    const weakPeers = peers.filter((r) => r.score <= weakThresh).map((r) => r.id);
    const strongPeers = peers.filter((r) => r.score >= strongThresh).map((r) => r.id);
    if (weakPeers.length || strongPeers.length) {
      const bits = [];
      if (strongPeers.length) bits.push(`stronger vs ${strongPeers.join("/")}`);
      if (weakPeers.length) bits.push(`weaker vs ${weakPeers.join("/")}`);
      parts.push(`FX peers: ${bits.join("; ")}.`);
    } else {
      parts.push("FX peers: session cross moves are modest / mixed.");
    }
  }

  const scored = ranking.length;
  const unscored = legs.length - scored;
  if (unscored > 0) {
    parts.push(
      `${unscored} basket leg(s) lack session Δ% on both sides — omitted from ranking bars (levels still in table).`
    );
  }
  if (!parts.length) {
    parts.push(
      `Level cross rates for ${code} via INR bridge. Ranking needs session Δ% on selected and legs.`
    );
  }
  return parts.join(" ");
}

function buildCompare(snap, codeRaw) {
  const selected = resolveSelected(snap, codeRaw);
  if (!selected) return null;

  const inrPer = buildInrPerMap(snap);
  const S = selected.inrPerUnit;
  const sChg = selected.changePct;
  const legs = [];
  const missing = [];

  const pushFxLeg = (code, label) => {
    const ip = inrPer[code];
    if (ip == null || !(ip > 0)) return;
    const unitsOfLegPerS = S / ip;
    const unitsOfSPerLeg = ip / S;
    const lChg = fxChangePct(snap, code);
    let deltaPct = null;
    if (sChg != null && lChg != null) deltaPct = Number((sChg - lChg).toFixed(4));
    legs.push({
      id: code,
      label: label || code,
      kind: "fx",
      unit: code,
      unitsPerSelected: roundNice(unitsOfLegPerS),
      selectedPerUnit: roundNice(unitsOfSPerLeg),
      quoteNote: `units of ${code} per 1 ${selected.code}`,
      inverseNote: `units of ${selected.code} per 1 ${code}`,
      deltaPct,
      strengthScore: deltaPct,
    });
  };

  const pushHardLeg = (id, label, unitShort) => {
    const h = findHard(snap, id);
    if (!h || !(h.inrPrice > 0)) {
      missing.push(`${label || id} not in snapshot`);
      return;
    }
    const unitsOfLegPerS = S / h.inrPrice;
    const unitsOfSPerLeg = h.inrPrice / S;
    const lChg = hardChangePct(h);
    let deltaPct = null;
    if (sChg != null && lChg != null) deltaPct = Number((sChg - lChg).toFixed(4));
    legs.push({
      id: String(id).toUpperCase(),
      label: label || h.name || id,
      kind: "hard",
      unit: unitShort || h.unit || id,
      unitsPerSelected: roundNice(unitsOfLegPerS),
      selectedPerUnit: roundNice(unitsOfSPerLeg),
      quoteNote: `${unitShort || "units"} per 1 ${selected.code}`,
      inverseNote: `${selected.code} per 1 ${unitShort || id}`,
      deltaPct,
      strengthScore: deltaPct,
      usdPrice: h.usdPrice ?? null,
      inrPrice: h.inrPrice,
      changePct: h.changePct ?? null,
    });
  };

  // Key basket only (peers + home + hard) — full universe remains in selectable
  const KEY_BASKET = [
    ["INR", "fx", "Indian rupee"],
    ["USD", "fx", "US dollar"],
    ["EUR", "fx", "Euro"],
    ["GBP", "fx", "Pound sterling"],
    ["JPY", "fx", "Japanese yen"],
    ["CNY", "fx", "Chinese yuan"],
    ["XAU", "hard", "Gold", "oz"],
    ["BTC", "hard", "Bitcoin", "BTC"],
    ["BRENT", "hard", "Brent crude", "bbl"],
    ["WTI", "hard", "WTI crude", "bbl"],
    ["COPPER", "hard", "Copper", "lb"],
    ["WHEAT", "hard", "Wheat", "bu"],
    ["NATGAS", "hard", "Natgas", "MMBtu"],
    ["CRYPTO_INDEX", "hard", "BTC+ETH proxy", "idx"],
  ];
  for (const row of KEY_BASKET) {
    const [code, kind, label, unit] = row;
    if (code === selected.code) continue;
    if (kind === "hard") pushHardLeg(code, label, unit);
    else pushFxLeg(code, label);
  }

  const presentHard = new Set(
    (snap.hardAssets || []).map((h) => String(h.id || "").toUpperCase())
  );
  for (const opt of [
    ["COPPER", "copper"],
    ["WHEAT", "wheat"],
    ["NATGAS", "natgas"],
    ["CRYPTO_INDEX", "crypto-index"],
  ]) {
    if (!presentHard.has(opt[0])) missing.push(`${opt[1]} not in snapshot`);
  }

  const kpi = {
    vsInr: {
      label: "vs INR",
      value: roundNice(S),
      unit: `INR per 1 ${selected.code}`,
      inverse: selected.code === "INR" ? null : roundNice(1 / S),
      inverseUnit: selected.code === "INR" ? null : `${selected.code} per 1 INR`,
    },
    vsUsd: null,
    vsGold: null,
  };
  if (inrPer.USD > 0) {
    const usdPerS = S / inrPer.USD;
    kpi.vsUsd = {
      label: "vs USD",
      value: roundNice(usdPerS),
      unit: `USD per 1 ${selected.code}`,
      inverse: roundNice(inrPer.USD / S),
      inverseUnit: `${selected.code} per 1 USD`,
      nativeNote: selected.kind === "fx" ? null : `via INR bridge (USDINR ${inrPer.USD})`,
    };
  }
  const gold = findHard(snap, "XAU");
  if (gold?.inrPrice > 0) {
    const ozPerS = S / gold.inrPrice;
    kpi.vsGold = {
      label: "vs gold",
      value: roundNice(ozPerS),
      unit: `oz gold per 1 ${selected.code}`,
      inverse: roundNice(gold.inrPrice / S),
      inverseUnit: `${selected.code} per 1 oz`,
      inrPerOz: gold.inrPrice,
      usdPerOz: gold.usdPrice ?? null,
    };
  }

  const ranking = legs
    .filter((l) => l.strengthScore != null && Number.isFinite(l.strengthScore))
    .map((l) => ({
      id: l.id,
      label: l.label,
      score: l.strengthScore,
      kind: l.kind,
    }))
    .sort((a, b) => b.score - a.score);

  const maxAbs = Math.max(...ranking.map((r) => Math.abs(r.score)), 1e-9);
  for (const r of ranking) {
    r.normalized = Number((r.score / maxAbs).toFixed(4));
  }

  const narrative = buildNarrative(selected, kpi, ranking, legs);

  const unavailable = (snap.meta?.unavailableExamples || []).map(
    (u) => `${u.code}: ${u.reason}`
  );

  return {
    code: selected.code,
    kind: selected.kind,
    unitLabel: selected.unitLabel,
    asOf: snap.asOf || null,
    live: !!snap.live,
    liveAsOf: snap.liveAsOf || null,
    selected: {
      code: selected.code,
      inrPerUnit: roundNice(selected.inrPerUnit),
      unitLabel: selected.unitLabel,
      changePct: selected.changePct,
    },
    kpi,
    legs,
    ranking,
    narrative,
    missingNotes: [...missing, ...unavailable.map((u) => `unavailable · ${u}`)],
    selectable: listSelectableCodes(snap),
    method:
      "Cross rates via INR bridge: units of X per 1 S = inrPer[S] / inrPer[X] (FX) or inrPer[S] / hard.inrPrice. Ranking scores ≈ Δ%S − Δ%leg (session relative strength; + = selected strengthened vs leg).",
  };
}


export { buildCompare, listSelectableCodes };
