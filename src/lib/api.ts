export type Snapshot = {
  asOf?: string;
  timezoneNote?: string;
  live?: boolean;
  fx?: Array<{
    pair: string;
    rate: number | null;
    changePct: number | null;
    source?: string;
    note?: string;
    available?: boolean;
    provider?: string;
    notOnEcb?: boolean;
  }>;
  hardAssets?: Array<{
    id: string;
    name?: string;
    unit?: string;
    usdPrice?: number | null;
    inrPrice?: number | null;
    changePct?: number | null;
    source?: string;
  }>;
  yields?: {
    asOf?: string;
    us2y?: number | null;
    us10y?: number | null;
    us10yMinus2y?: number | null;
    source?: string;
  };
  realStrength?: {
    summary?: string;
    legs?: Array<{ lens: string; verdict: string; detail?: string }>;
  };
  scriptures?: string[];
  assumptions?: string[];
  meta?: Record<string, unknown>;
  dataSource?: "kv" | "assets" | string;
};

export type History = {
  asOf?: string;
  source?: string;
  from?: string;
  to?: string;
  dayCount?: number;
  series?: Record<string, Array<{ t: string; v: number }>>;
  hardAssets?: Record<string, Array<{ t: string; v: number }>>;
  dataSource?: string;
};

export type Health = {
  ok?: boolean;
  service?: string;
  asOf?: string;
  fxCount?: number;
  dataSource?: string;
  lastRefresh?: string | null;
  kv?: boolean;
  cron?: string | null;
};

async function fetchJsonTimed(url: string, ms = 4000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSnapshot(): Promise<{ data: Snapshot; via: string }> {
  try {
    const res = await fetchJsonTimed("/api/snapshot", 4000);
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) return { data, via: "api" };
    }
  } catch {}
  const res = await fetchJsonTimed("/data/snapshot.json", 4000);
  if (!res.ok) throw new Error(`snapshot unavailable (${res.status})`);
  return { data: await res.json(), via: "baked" };
}

export async function loadHistory(): Promise<{ data: History; via: string }> {
  try {
    const res = await fetchJsonTimed("/api/history", 5000);
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) return { data, via: "api" };
    }
  } catch {}
  try {
    const res = await fetchJsonTimed("/data/history.json", 5000);
    if (res.ok) return { data: await res.json(), via: "baked" };
  } catch {}
  return { data: { series: {} }, via: "empty" };
}

export async function loadHealth(): Promise<Health | null> {
  try {
    const res = await fetchJsonTimed("/api/health", 4000);
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function loadCompare(code: string): Promise<any> {
  const c = encodeURIComponent(code || "USD");
  try {
    const res = await fetchJsonTimed(`/api/compare?code=${c}`, 5000);
    if (res.ok) return await res.json();
    if (res.status === 404) return await res.json();
  } catch {}
  return null;
}
