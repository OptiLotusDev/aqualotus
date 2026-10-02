import { useEffect, useState } from 'react'
import {
  optilotus_execMath,
  optilotus_health,
  optilotus_tryEnsure,
  optilotus_version,
} from '../lib/optilotus'

/** Immutable snapshot of bridge state for the status panel (P9). */
export interface OptilotusStatus {
  readonly wasmStatus: string;
  readonly version: string;
  readonly health: string;
  readonly mathDemo: string;
}

const LOADING: OptilotusStatus = {
  wasmStatus: 'loading Optilotus WASM…',
  version: '',
  health: '',
  mathDemo: '',
}

/**
 * Data hook (P1/P10): owns async bridge state. Renders nothing;
 * `OptilotusPanel` presents the snapshot it returns.
 *
 * The demo expression uses literals only, so it never touches the
 * shared session (no variables to leak into the user's flow).
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
          mathDemo: optilotus_execMath('(3 + 4) % 2'),
        });
      })
      .catch((e: unknown) => {
        setStatus({ ...LOADING, wasmStatus: `failed: ${String(e)}` });
      });
  }, [])

  return status
}
