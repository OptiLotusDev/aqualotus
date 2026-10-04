import { useCallback, useEffect, useState } from "react";
import {
  optilotus_health,
  optilotus_tryEnsure,
  optilotus_version,
} from "../lib/optilotus";

/** Lifecycle of the one-time Optilotus WASM initialization. */
export type RuntimePhase = "loading" | "ready" | "failed";

/** Immutable snapshot owned by `useRuntime` (P10). */
export interface RuntimeStatus {
  readonly phase: RuntimePhase;
  readonly version: string;
  readonly health: string;
  readonly error: string;
}

const LOADING: RuntimeStatus = {
  phase: "loading",
  version: "",
  health: "",
  error: "",
};

/**
 * Owns WASM init state. Calls `optilotus_tryEnsure()` exactly once per
 * mount and exposes a readonly snapshot; renders nothing.
 */
export function useRuntime(): {
  status: RuntimeStatus;
  retry: () => void;
} {
  const [status, setStatus] = useState<RuntimeStatus>(LOADING);
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    optilotus_tryEnsure()
      .then(() => {
        if (cancelled) return;
        setStatus({
          phase: "ready",
          version: optilotus_version(),
          health: optilotus_health(),
          error: "",
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus({
          ...LOADING,
          phase: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback((): void => {
    setStatus(LOADING);
    setAttempt((n) => n + 1);
  }, []);

  return { status, retry };
}
