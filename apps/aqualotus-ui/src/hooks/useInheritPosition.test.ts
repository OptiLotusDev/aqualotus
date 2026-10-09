import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInheritPosition } from "./useInheritPosition";
import type { CommandSummary } from "../lib/optilotus";

function declareCmd(id: number, next: number | null): CommandSummary {
  return { id, kind: "declare", next, var: "n", ty: "int32", expr: "41" };
}

describe("useInheritPosition", () => {
  it("hands the old position to the recreated command", () => {
    const moveBlockIn = vi.fn();
    const before = { 0: [declareCmd(1, 2), declareCmd(2, null)] };
    const { result, rerender } = renderHook(
      ({ cmds, busy }) => useInheritPosition(cmds, busy, moveBlockIn),
      { initialProps: { cmds: before, busy: false } },
    );
    result.current.captureInherit(0, { x: 48, y: 36 }, [1, 2]);
    // In-flight refresh with no newcomer yet: nothing moves.
    rerender({ cmds: before, busy: true });
    expect(moveBlockIn).not.toHaveBeenCalled();
    // Recreated command (fresh id 7) appears: inherits the position.
    rerender({
      cmds: { 0: [declareCmd(2, null), declareCmd(7, 2)] },
      busy: false,
    });
    expect(moveBlockIn).toHaveBeenCalledOnce();
    expect(moveBlockIn).toHaveBeenCalledWith(0, 7, { x: 48, y: 36 });
  });

  it("clears a failed edit without moving anything", () => {
    const moveBlockIn = vi.fn();
    const cmds = { 0: [declareCmd(1, null)] };
    const { result, rerender } = renderHook(
      ({ c, busy }) => useInheritPosition(c, busy, moveBlockIn),
      { initialProps: { c: cmds, busy: false } },
    );
    result.current.captureInherit(0, { x: 48, y: 36 }, [1]);
    // Edit rejected: same ids, settled — pending clears…
    rerender({ c: cmds, busy: false });
    expect(moveBlockIn).not.toHaveBeenCalled();
    // …so a later unrelated newcomer is left alone.
    rerender({ c: { 0: [declareCmd(1, null), declareCmd(9, null)] }, busy: false });
    expect(moveBlockIn).not.toHaveBeenCalled();
  });
});
