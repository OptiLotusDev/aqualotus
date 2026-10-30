/**
 * Pure presentation helpers for the application shell.
 *
 * No React state, no bridge calls — pure functions over input data.
 */

import type { RunResult } from "../lib/optilotus";
import type { ProgramSnapshot } from "../hooks/useProgram";

/** Displayed app version: the live engine version once the bridge is
 * ready, else the build-time version read from the engine's
 * `Cargo.toml` — a `Cargo.toml` bump reaches the pill with no UI edit. */
export function displayVersion(runtimeVersion: string): string {
  if (runtimeVersion !== "") return runtimeVersion;
  try {
    return __OPTILOTUS_VERSION__;
  } catch {
    return "?";
  }
}

/** Default name for function blocks created from the library. */
export function nextHelperName(
  existing: readonly { name: string }[],
): string {
  if (!existing.some((f) => f.name === "helper")) return "helper";
  let n = 1;
  while (existing.some((f) => f.name === `helper${n}`)) {
    n += 1;
  }
  return `helper${n}`;
}

/** Compact runner pill dot state for the collapsed dock. */
export function pillState(running: boolean, run: RunResult | null): string {
  if (running) return "busy";
  if (run === null) return "idle";
  return run.status === "ok" ? "ready" : "error";
}

/** Compact runner pill text for the collapsed dock. */
export function runnerSummary(program: ProgramSnapshot): string {
  if (program.running) return "Running…";
  const run = program.run;
  if (run === null) return "Runner";
  if (run.status === "ok") {
    const ms = program.durationMs;
    return `Completed${ms !== null ? ` · ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : ""}`;
  }
  return "Run failed";
}
