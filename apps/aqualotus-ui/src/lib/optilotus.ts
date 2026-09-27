import init, {
  optilotus_add,
  optilotus_empty_program,
  optilotus_health,
  optilotus_run_empty,
  optilotus_version,
} from "../wasm/optilotus/optilotus.js";

let ready: Promise<void> | null = null;

/** Load the Optilotus WASM module once. Must be awaited before calling. */
export function ensureOptilotus(): Promise<void> {
  if (!ready) {
    ready = init().then(() => undefined);
  }
  return ready;
}

export function getVersion(): string {
  return optilotus_version();
}

export function getHealth(): string {
  return optilotus_health();
}

export function getEmptyProgram(): string {
  return optilotus_empty_program();
}

export function runEmpty(): string {
  return optilotus_run_empty();
}

/** u64 add via WASM (bigint on the boundary, number for small values). */
export function add(a: number, b: number): number {
  return Number(optilotus_add(BigInt(a), BigInt(b)));
}
