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
    const base = request?.url || "https://v2.fx-analysis.tanishqnalloju.com/";
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

export default {
  async fetch(request, env) {
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
        service: "fx-analysis-v2",
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
