import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInheritPosition } from "../../hooks/useInheritPosition";
import type { CommandSummary } from "../../lib/optilotus";
import type { LayoutMap } from "../../lib/layout";

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

  it("restores an undone delete at its old spot, not the row end", () => {
    const moveBlockIn = vi.fn();
    const positions: Record<number, LayoutMap> = {
      0: { 1: { x: 48, y: 36 }, 2: { x: 312, y: 36 } },
    };
    const { result, rerender } = renderHook(
      ({ cmds, busy, positions: pos }) =>
        useInheritPosition(cmds, busy, moveBlockIn, pos),
      {
        initialProps: {
          cmds: { 0: [declareCmd(1, 2), declareCmd(2, null)] },
          busy: false,
          positions,
        },
      },
    );
    // Delete block 1 (no arm involved): its spot is remembered.
    const afterDelete: Record<number, LayoutMap> = {
      0: { 2: { x: 312, y: 36 } },
    };
    rerender({
      cmds: { 0: [declareCmd(2, null)] },
      busy: false,
      positions: afterDelete,
    });
    expect(moveBlockIn).not.toHaveBeenCalled();
    // Undo recreates it under a fresh id: armed, so it reclaims the
    // remembered spot instead of landing at the row end.
    result.current.armRestore();
    rerender({
      cmds: { 0: [declareCmd(2, null), declareCmd(7, null)] },
      busy: false,
      positions: afterDelete,
    });
    expect(moveBlockIn).toHaveBeenCalledOnce();
    expect(moveBlockIn).toHaveBeenCalledWith(0, 7, { x: 48, y: 36 });
  });

  it("leaves fresh adds at the row end even with remembered spots", () => {
    const moveBlockIn = vi.fn();
    const start: Record<number, LayoutMap> = {
      0: { 1: { x: 48, y: 36 }, 2: { x: 312, y: 36 } },
    };
    const afterDelete: Record<number, LayoutMap> = {
      0: { 2: { x: 312, y: 36 } },
    };
    const afterAdd: Record<number, LayoutMap> = {
      0: { 2: { x: 312, y: 36 }, 9: { x: 576, y: 36 } },
    };
    const { result, rerender } = renderHook(
      ({ cmds, busy, positions: pos }) =>
        useInheritPosition(cmds, busy, moveBlockIn, pos),
      {
        initialProps: {
          cmds: { 0: [declareCmd(1, 2), declareCmd(2, null)] },
          busy: false,
          positions: start,
        },
      },
    );
    // Delete block 1: spot remembered.
    rerender({
      cmds: { 0: [declareCmd(2, null)] },
      busy: false,
      positions: afterDelete,
    });
    // Fresh add (no arm): placed by reconciliation, never moved here.
    rerender({
      cmds: { 0: [declareCmd(2, null), declareCmd(9, null)] },
      busy: false,
      positions: afterAdd,
    });
    expect(moveBlockIn).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
