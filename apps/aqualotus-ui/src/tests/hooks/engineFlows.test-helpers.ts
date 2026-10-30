import { expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetRealEngine } from "../../test-support/realEngine";
import { planDropLink } from "../../lib/graph";
import { useProgram } from "../../hooks/useProgram";

let seq = 0;
export function issueSeq(): number {
  seq += 1;
  return seq;
}

export type Api = ReturnType<typeof useProgram>;

export async function freshHook(): Promise<{ api: () => Api }> {
  resetRealEngine();
  seq = 0;
  const { result } = renderHook(() => useProgram(true, issueSeq));
  await act(async () => {
    await Promise.resolve();
  });
  return { api: () => result.current };
}

/** Chain every block head-to-tail in creation order via port drops. */
export function chainInOrder(api: () => Api, fid = 0): void {
  const ids = api().snapshot.commands.map((c) => c.id);
  for (let i = 1; i < ids.length; i += 1) {
    const list = api().snapshot.commands.map((c) => ({
      id: c.id,
      next: c.next ?? null,
    }));
    const entry = api().snapshot.selected?.entry ?? null;
    const prev = ids[i - 1] as number;
    const cur = ids[i] as number;
    const plan = planDropLink(list, entry, prev, cur, "before");
    expect(plan).not.toBe(null);
    act(() => {
      api().applyLinks(fid, plan!);
    });
  }
}

export function printed(api: () => Api): string[] {
  const run = api().snapshot.run;
  expect(run?.status).toBe("ok");
  return run?.status === "ok" ? [...run.printed] : [];
}
