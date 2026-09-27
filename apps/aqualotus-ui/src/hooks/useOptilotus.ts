import { useEffect, useState } from 'react'
import {
  optilotus_add,
  optilotus_emptyProgram,
  optilotus_health,
  optilotus_runEmpty,
  optilotus_tryEnsure,
  optilotus_version,
} from '../lib/optilotus'

/** Immutable snapshot of bridge state for the status panel (P9). */
export interface OptilotusStatus {
  readonly wasmStatus: string;
  readonly version: string;
  readonly health: string;
  readonly emptyProgram: string;
  readonly runResult: string;
  readonly addResult: string;
}

const LOADING: OptilotusStatus = {
  wasmStatus: 'loading Optilotus WASM…',
  version: '',
  health: '',
  emptyProgram: '',
  runResult: '',
  addResult: '',
}

/**
 * Data hook (P1/P10): owns async bridge state. Renders nothing;
 * `OptilotusPanel` presents the snapshot it returns.
 */
export function useOptilotus(): OptilotusStatus {
  const [status, setStatus] = useState<OptilotusStatus>(LOADING)

  useEffect(() => {
    optilotus_tryEnsure()
      .then(() => {
        setStatus({
          wasmStatus: 'connected',
          version: optilotus_version(),
          health: optilotus_health(),
          emptyProgram: optilotus_emptyProgram(),
          runResult: optilotus_runEmpty(),
          addResult: String(optilotus_add(2, 3)),
        });
      })
      .catch((e: unknown) => {
        setStatus({ ...LOADING, wasmStatus: `failed: ${String(e)}` });
      });
  }, [])

  return status
}
