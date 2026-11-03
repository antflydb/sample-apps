import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import type { Config, Source, Status } from "../types";

interface Data {
  config: Config | null;
  sources: Source[] | null;
  status: Status | null;
  /** Message from the last failed load, or "" */
  error: string;
  refresh: () => Promise<void>;
  /** Poll every few seconds while anything is syncing or pending. Returns a release fn. */
  watch: () => () => void;
}

const Ctx = createContext<Data | null>(null);
const POLL_MS = 3000;

export function DataProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [watchers, setWatchers] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    const p = Promise.all([api.sources(), api.status()])
      .then(([s, st]) => {
        setSources(s ?? []);
        setStatus(st);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig({ demo: false, repo_url: "" }));
    void refresh();
  }, [refresh]);

  const busy =
    (sources?.some((s) => s.status === "syncing") ?? false) || (status?.pending ?? 0) > 0;

  useEffect(() => {
    if (watchers === 0 || !busy) return;
    const t = window.setTimeout(() => void refresh(), POLL_MS);
    return () => window.clearTimeout(t);
    // sources/status change after every poll, which schedules the next one.
  }, [watchers, busy, sources, status, refresh]);

  const watch = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);

  const value = useMemo(
    () => ({ config, sources, status, error, refresh, watch }),
    [config, sources, status, error, refresh, watch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const d = useContext(Ctx);
  if (!d) throw new Error("useData outside DataProvider");
  return d;
}
