import { useEffect, useState } from 'react'
import {
  optilotus_assign,
  optilotus_clearPackage,
  optilotus_declare,
  optilotus_health,
  optilotus_printCommand,
  optilotus_runProgram,
  optilotus_tryEnsure,
  optilotus_type,
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

/** Demo `(3 + 4) % 2` built with the package API (IDs only, no IR JSON). */
function runMathDemo(): string {
  optilotus_clearPackage();
  const declared = optilotus_declare(0, 'n', optilotus_type.int32, '3');
  if (declared.status !== 'ok') return `error: ${declared.message}`;
  const assigned = optilotus_assign(0, 'n', '({n} + 4) % 2');
  if (assigned.status !== 'ok') return `error: ${assigned.message}`;
  const printed = optilotus_printCommand(0, '"{n}"');
  if (printed.status !== 'ok') return `error: ${printed.message}`;
  const result = optilotus_runProgram();
  if (result.status !== 'ok') return `error: ${result.message}`;
  return result.printed[0] ?? '';
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
          mathDemo: runMathDemo(),
        });
      })
      .catch((e: unknown) => {
        setStatus({ ...LOADING, wasmStatus: `failed: ${String(e)}` });
      });
  }, [])

  return status
}
