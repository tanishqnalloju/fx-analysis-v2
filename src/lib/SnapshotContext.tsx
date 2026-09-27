import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadHistory, loadHealth, loadSnapshot, type Health, type History, type Snapshot } from "./api";
import { buildRegime, type Regime } from "./regime";
import {
  buildDailyTakeaway,
  buildHomeVerdict,
  buildRealStrengthBlurb,
  buildSlipSummaryFlags,
} from "./takeaway";

type Ctx = {
  snap: Snapshot | null;
  history: History | null;
  health: Health | null;
  via: string | null;
  loading: boolean;
  error: string | null;
  regime: Regime | null;
  strength: ReturnType<typeof buildRealStrengthBlurb> | null;
  homeVerdict: ReturnType<typeof buildHomeVerdict> | null;
  slip: ReturnType<typeof buildSlipSummaryFlags> | null;
  daily: ReturnType<typeof buildDailyTakeaway> | null;
  reload: () => void;
};

const SnapshotContext = createContext<Ctx | null>(null);

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [via, setVia] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, h, heal] = await Promise.all([
          loadSnapshot(),
          loadHistory(),
          loadHealth(),
        ]);
        if (cancelled) return;
        setSnap(s.data);
        setVia(s.via);
        setHistory(h.data);
        setHealth(heal);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load snapshot");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const derived = useMemo(() => {
    if (!snap) {
      return { regime: null, strength: null, homeVerdict: null, slip: null, daily: null };
    }
    const regime = buildRegime(snap, history);
    const strength = buildRealStrengthBlurb(snap, regime);
    const homeVerdict = buildHomeVerdict(snap, regime, strength);
    const slip = buildSlipSummaryFlags(snap, history);
    const daily = buildDailyTakeaway(snap, history, regime, slip);
    return { regime, strength, homeVerdict, slip, daily };
  }, [snap, history]);

  const value: Ctx = {
    snap,
    history,
    health,
    via,
    loading,
    error,
    ...derived,
    reload: () => setTick((t) => t + 1),
  };

  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>;
}

export function useSnapshot() {
  const ctx = useContext(SnapshotContext);
  if (!ctx) throw new Error("useSnapshot outside provider");
  return ctx;
}
