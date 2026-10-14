/**
 * Cloudflare Worker — FX Analysis v2 (READ-ONLY)
 * Serves SPA assets + GET /api/* from shared KV (same as v1).
 * NO cron. NO /api/refresh.
 */
import { buildCompare, listSelectableCodes } from "./domain/compare-server.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const KV_KEYS = { snapshot: "snapshot", history: "history", meta: "meta" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

async function loadBakedAsset(env, request, path) {
  if (!env.ASSETS) return null;
  try {
    const base = request?.url || "https://fx-analysis.tanishqnalloju.com/";
    const assetUrl = new URL(path, base);
    const res = await env.ASSETS.fetch(new Request(assetUrl));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function kvGetJson(env, key) {
  if (!env.DATA) return null;
  try {
    const raw = await env.DATA.get(key, "json");
    return raw ?? null;
  } catch {
    return null;
  }
}

async function loadSnapshotBase(env, request) {
  const fromKv = await kvGetJson(env, KV_KEYS.snapshot);
  if (fromKv?.fx?.length) return { ...fromKv, dataSource: "kv" };
  const baked = await loadBakedAsset(env, request, "/data/snapshot.json");
  if (baked) return { ...baked, dataSource: "assets" };
  return null;
}

async function loadHistoryBase(env, request) {
  const fromKv = await kvGetJson(env, KV_KEYS.history);
  if (fromKv?.series) return { ...fromKv, dataSource: "kv" };
  const baked = await loadBakedAsset(env, request, "/data/history.json");
  if (baked) return { ...baked, dataSource: "assets" };
  return null;
}


/** Read-only long daily history from Frankfurter (ECB reference), cross via USD. Edge-cached 6h. */
async function loadLongHistory(env, request, ctx) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request("https://cache.internal/longhistory-v1");
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const snap = await loadSnapshotBase(env, request);
  const codes = (snap?.fx || [])
    .map((r) => String(r.pair || "").replace(/INR$/, ""))
    .filter((c) => /^[A-Z]{3}$/.test(c) && c !== "USD");
  const from = new Date(Date.now() - 420 * 86400000).toISOString().slice(0, 10);
  const src = `https://api.frankfurter.dev/v1/${from}..?base=USD&symbols=INR,${codes.join(",")}`;
  let body;
  try {
    const r = await fetch(src, { cf: { cacheTtl: 21600 } });
    if (!r.ok) throw new Error("upstream " + r.status);
    const d = await r.json();
    const series = {};
    for (const [t, row] of Object.entries(d.rates || {})) {
      const inr = row.INR;
      if (!inr) continue;
      (series.USDINR ||= []).push({ t, v: +inr.toFixed(6) });
      for (const c of codes) {
        if (row[c]) (series[c + "INR"] ||= []).push({ t, v: +(inr / row[c]).toPrecision(8) });
      }
    }
    body = { source: "Frankfurter / ECB reference rates (daily close, cross via USD)", sourceUrl: src, from: d.start_date, to: d.end_date, series };
  } catch (e) {
    return json({ error: "long history unavailable", detail: String(e?.message || e) }, 503);
  }
  const res = json(body);
  res.headers.set("Cache-Control", "public, max-age=21600");
  if (cache && ctx) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

const ECB_CODES = new Set("AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR".split(" "));
const PAIR_FROM = "2010-01-01";
async function loadPairHistory(request, ctx, code) {
  if (!ECB_CODES.has(code)) return json({ error: "unsupported code (ECB reference set only)", code, supported: [...ECB_CODES] }, 400);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`https://cache.internal/pairhistory-v1/${code}`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const src = code === "USD"
    ? `https://api.frankfurter.dev/v1/${PAIR_FROM}..?base=USD&symbols=INR`
    : `https://api.frankfurter.dev/v1/${PAIR_FROM}..?base=${code}&symbols=INR`;
  let body;
  try {
    const r = await fetch(src, { cf: { cacheTtl: 21600 } });
    if (!r.ok) throw new Error("upstream " + r.status);
    const d = await r.json();
    const pts = Object.entries(d.rates || {}).filter(([, row]) => row.INR).map(([t, row]) => [t, row.INR]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    body = { pair: code + "INR", source: "Frankfurter / ECB reference rates (daily, ~16:00 CET)", sourceUrl: src, from: pts[0]?.[0], to: pts.at(-1)?.[0], points: pts };
  } catch (e) {
    return json({ error: "pair history unavailable", detail: String(e?.message || e) }, 503);
  }
  const res = json(body);
  res.headers.set("Cache-Control", "public, max-age=21600");
  if (cache && ctx) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Explicitly refuse refresh on v2
    if (path === "/api/refresh") {
      return json(
        {
          error: "not available",
          message: "fx-analysis-v2 is read-only; refresh lives on fx-analysis (v1)",
        },
        405
      );
    }

    if (path === "/api/health" && request.method === "GET") {
      const meta = await kvGetJson(env, KV_KEYS.meta);
      const snap = await loadSnapshotBase(env, request);
      return json({
        ok: true,
        service: env.SERVICE_NAME || "fx-analysis-v2",
        asOf: snap?.asOf ?? null,
        fxCount: snap?.fx?.length ?? 0,
        dataSource: snap?.dataSource ?? null,
        lastRefresh: meta?.lastRefresh ?? null,
        kv: !!env.DATA,
        cron: null,
      });
    }

    if (path === "/api/snapshot" && request.method === "GET") {
      const snap = await loadSnapshotBase(env, request);
      if (!snap) return json({ error: "snapshot unavailable" }, 503);
      return json(snap);
    }

    if (path === "/api/history" && request.method === "GET") {
      const hist = await loadHistoryBase(env, request);
      if (!hist) return json({ error: "history unavailable" }, 503);
      return json(hist);
    }

    if (path === "/api/longhistory" && request.method === "GET") {
      return loadLongHistory(env, request, ctx);
    }

    if (path === "/api/pairhistory" && request.method === "GET") {
      return loadPairHistory(request, ctx, (url.searchParams.get("code") || "").trim().toUpperCase());
    }

    if (path === "/api/meta" && request.method === "GET") {
      const meta = await kvGetJson(env, KV_KEYS.meta);
      return json(meta || { lastRefresh: null, note: "no meta in KV yet" });
    }

    let compareCode = null;
    if (path === "/api/compare" && request.method === "GET") {
      compareCode = (url.searchParams.get("code") || "").trim().toUpperCase();
    } else {
      const m = path.match(/^\/api\/compare\/([A-Za-z0-9_]+)$/);
      if (m && request.method === "GET") compareCode = m[1].toUpperCase();
    }

    if (compareCode !== null && path.startsWith("/api/compare")) {
      if (!compareCode) {
        const snap = await loadSnapshotBase(env, request);
        return json(
          {
            error: "missing code query param",
            hint: "GET /api/compare?code=USD",
            selectable: snap ? listSelectableCodes(snap) : [],
          },
          400
        );
      }
      const snap = await loadSnapshotBase(env, request);
      if (!snap) return json({ error: "snapshot unavailable" }, 503);
      const payload = buildCompare(snap, compareCode);
      if (!payload) {
        return json(
          {
            error: "unknown currency or asset code",
            code: compareCode,
            selectable: listSelectableCodes(snap),
          },
          404
        );
      }
      return json(payload);
    }

    // SPA + static: Assets binding with not_found_handling SPA
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return json({ error: "Not found", path }, 404);
  },
};
