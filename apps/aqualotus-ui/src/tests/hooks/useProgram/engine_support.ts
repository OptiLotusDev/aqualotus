/**
 * Shared test support for `useProgram` engine integration tests.
 *
 * Mounts the hook against the **real** Optilotus WASM artifact and
 * provides the connection helper used by every engine test suite.
 */

import { act, renderHook } from "@testing-library/react";
import { planChainAll } from "../../../lib/graph";
import { useProgram } from "../../../hooks/useProgram";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";

let seq = 0;
/** Monotonic sequence for unique `issueSeq` values per hook mount. */
export function issueSeq(): number {
  seq += 1;
  return seq;
}

/** Mount the hook and let its initial projection load settle. */
export async function setup(): Promise<{
  result: { current: ReturnType<typeof useProgram> };
}> {
  const view = renderHook(() => useProgram(true, issueSeq));
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/**
 * Connect every block of a function head-to-tail, exactly like the
 * canvas' "Connect blocks in order" action does.
 */
export function connectAll(
  api: () => ReturnType<typeof useProgram>,
  fid: number,
): void {
  const cmds = api().snapshot.commands.map((c) => ({
    id: c.id,
    next: c.next ?? null,
    then_body: c.then_body,
    else_body: c.else_body,
  }));
  const entry = api().snapshot.entry;
  const plan = planChainAll(cmds, entry);
  if (plan === null) return;
  act(() => {
    api().applyLinks(fid, plan);
  });
}

export type Api = ReturnType<typeof useProgram>;

export { resetRealEngine, useRealEngine };
