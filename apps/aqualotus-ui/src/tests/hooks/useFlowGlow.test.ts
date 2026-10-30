import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFlowGlow } from "../../hooks/useFlowGlow";
import { optilotus_if_condition } from "../../lib/optilotus";
import type { ProgramSnapshot } from "../../hooks/useProgram";
import { FLOW_LINK_MS, type RunPrinted } from "../../lib/flow";

/**
 * The execution-flow model of the shell: which connections travel, in
 * which order, and when the visualisation is over. The bridge lookup
 * that seeds the chain is mocked — the UI never invents an order the
 * engine did not give it, and a branch glow comes only from the run's
 * own printed window (or from the literal condition the engine itself
 * reports at the freeze).
 */

vi.mock("../../lib/optilotus", () => ({
  optilotus_getFunction: vi.fn(() => ({
    status: "ok",
    id: 0,
    name: "main",
    isMain: true,
    entry: 1,
    commandCount: 3,
  })),
  // The literal-condition probe answers an error by default, so the
  // envelope decides on its own unless a test overrides it.
  optilotus_if_condition: vi.fn(() => ({ status: "error" })),
}));

function chainCommands(): ProgramSnapshot["commands"] {
  return [
    { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
    { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
    { id: 3, kind: "print", next: null, template: '"{n}"' },
  ] as ProgramSnapshot["commands"];
}

function snapshot(
  commands: ProgramSnapshot["commands"] = chainCommands(),
): ProgramSnapshot {
  return {
    functions: [{ id: 0, name: "main", isMain: true }],
    selectedId: 0,
    selected: null,
    entry: 1,
    commands,
    commandsByFunction: { 0: commands },
    selectedCommandId: null,
    run: null,
    running: false,
    durationMs: null,
    busy: false,
    actionError: "",
    error: null,
    errorBlockId: null,
    errorFunctionId: null,
    recoveryVar: null,
  };
}

function okRun(printed: RunPrinted): ProgramSnapshot["run"] {
  return {
    status: "ok",
    steps: printed.length + 1,
    prints: printed.length,
    printed: [...printed],
    returned: null,
  };
}

/**
 * A snapshot graph where an `if` splits the chain: declare → if → join
 * print, one print member on each side. Templates are variable refs on
 * both sides except where a test overrides them, so only count or
 * literal evidence can decide the branch.
 */
function branching(): ProgramSnapshot {
  const commands = [
    { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
    { id: 2, kind: "if", next: 5, then_body: [3], else_body: [4] },
    { id: 3, kind: "print", next: null, template: '"{n}"' },
    { id: 4, kind: "print", next: null, template: '"{n}"' },
    { id: 5, kind: "print", next: null, template: '"{n}"' },
  ] as ProgramSnapshot["commands"];
  const snap = snapshot(commands) as ProgramSnapshot;
  // The projection plumbs branch bodies through; tests only need the
  // structural fields the resolver reads.
  return snap;
}

describe("useFlowGlow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Every test starts from the settled default: the probe answers an
    // error (nothing literal reported), and mock implementations set by
    // earlier tests never leak.
    vi.mocked(optilotus_if_condition).mockImplementation(() => ({
      status: "error",
      kind: "PackageError",
      command: null,
      message: "no literal condition",
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("travels the chain of the entry function, in order", () => {
    const { result } = renderHook(() => useFlowGlow(snapshot()));
    act(() => {
      result.current.startFlow();
    });
    expect(result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "chain" },
    ]);
    expect(result.current.flow?.linkMs).toBe(FLOW_LINK_MS);
  });

  it("does nothing without an executed chain", () => {
    const empty = { ...snapshot(), functions: [], commandsByFunction: {} };
    const { result } = renderHook(() => useFlowGlow(empty));
    act(() => {
      result.current.startFlow();
    });
    expect(result.current.flow).toBeNull();
  });

  it("follows the branch the run's window proves", () => {
    // `then` holds one literal print the window confirms at the exact
    // position; `else` holds none. The sweep enters `then` from the
    // `if`, walks its member, merges to the join and continues.
    const commands = [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
      { id: 2, kind: "if", next: 6, then_body: [3], else_body: [] },
      { id: 3, kind: "print", next: null, template: '"true side"' },
      { id: 6, kind: "print", next: null, template: '"{n}"' },
    ] as ProgramSnapshot["commands"];
    const program = { ...snapshot(commands), run: okRun(["true side", "42"]) };
    const { result } = renderHook(() => useFlowGlow(program));
    act(() => {
      result.current.startFlow();
    });
    expect(result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "branch-head" },
      { fid: 0, from: 3, to: 6, kind: "merge" },
      { fid: 0, from: 2, to: 6, kind: "chain" },
    ]);
  });

  it("never glows a branch the window does not prove", () => {
    // Identical variable templates on both sides: the envelope cannot
    // name the taken branch, so the `if` stays undecided and the sweep
    // travels the chain and the if→join edge only.
    const program = { ...branching(), run: okRun(["5"]) };
    const { result } = renderHook(() => useFlowGlow(program));
    act(() => {
      result.current.startFlow();
    });
    expect(result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("splits an unprovable tie with the literal condition the engine holds", () => {
    // The envelope alone cannot decide (identical prints); the bridge's
    // own `if_condition` can: the freeze reads it as TRUE, so THEN
    // travels — and as FALSE, so ELSE does. Read from the engine, not
    // evaluated by the UI.
    const trueProgram = { ...branching(), run: okRun(["5"]) };
    vi.mocked(optilotus_if_condition).mockImplementation(() => ({
      status: "ok",
      expr: "true",
    }));
    const thenHook = renderHook(() => useFlowGlow(trueProgram));
    act(() => {
      thenHook.result.current.startFlow();
    });
    expect(thenHook.result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "branch-head" },
      { fid: 0, from: 3, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);

    vi.mocked(optilotus_if_condition).mockImplementation(() => ({
      status: "ok",
      expr: "false",
    }));
    const elseHook = renderHook(() => useFlowGlow({ ...branching(), run: okRun(["5"]) }));
    act(() => {
      elseHook.result.current.startFlow();
    });
    expect(elseHook.result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 4, kind: "branch-head" },
      { fid: 0, from: 4, to: 5, kind: "merge" },
      { fid: 0, from: 2, to: 5, kind: "chain" },
    ]);
  });

  it("treats a failed run as a windowless run (never decides a branch)", () => {
    const commands = [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
      { id: 2, kind: "if", next: 6, then_body: [3], else_body: [] },
      { id: 3, kind: "print", next: null, template: '"true side"' },
      { id: 6, kind: "print", next: null, template: '"{n}"' },
    ] as ProgramSnapshot["commands"];
    const program = {
      ...snapshot(commands),
      run: {
        status: "error",
        kind: "TypeMismatch",
        command: 3,
        message: "type mismatch at 3",
      },
      errorBlockId: 3,
    } as ProgramSnapshot;
    const { result } = renderHook(() => useFlowGlow(program));
    act(() => {
      result.current.startFlow();
    });
    expect(result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 6, kind: "chain" },
    ]);
  });

  it("ends the sweep on its own", () => {
    const { result } = renderHook(() => useFlowGlow(snapshot()));
    act(() => {
      result.current.startFlow();
    });
    expect(result.current.flow).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2 * FLOW_LINK_MS + 50);
    });
    // Nothing is left animating when the sweep is over.
    expect(result.current.flow).toBeNull();
  });

  it("replaces the previous sweep on a new run", () => {
    const { result } = renderHook(() => useFlowGlow(snapshot()));
    act(() => {
      result.current.startFlow();
    });
    const first = result.current.flow?.runId;
    act(() => {
      result.current.startFlow();
    });
    // A new run id: the travel restarts instead of stacking.
    expect(result.current.flow?.runId).not.toBe(first);
    expect(result.current.flow?.edges.length).toBe(2);
  });

  it("stops the travel at the block the failure points at", () => {
    const { result, rerender } = renderHook(
      ({ program }: { program: ProgramSnapshot }) => useFlowGlow(program),
      { initialProps: { program: snapshot() } },
    );
    act(() => {
      result.current.startFlow();
    });
    // The failure resolved to block 2: the connection that fed it ran,
    // the one after it did not.
    rerender({ program: { ...snapshot(), errorBlockId: 2 } });
    expect(result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
    ]);
  });

  it("travels nothing when the chain head itself failed", () => {
    const { result, rerender } = renderHook(
      ({ program }: { program: ProgramSnapshot }) => useFlowGlow(program),
      { initialProps: { program: snapshot() } },
    );
    act(() => {
      result.current.startFlow();
    });
    // The head never reached its successor: no connection of the chain
    // carried anything, so none of them may travel.
    rerender({ program: { ...snapshot(), errorBlockId: 1 } });
    expect(result.current.flow?.edges).toEqual([]);
  });

  it("does not stop at an unresolved failure", () => {
    const { result, rerender } = renderHook(
      ({ program }: { program: ProgramSnapshot }) => useFlowGlow(program),
      { initialProps: { program: snapshot() } },
    );
    act(() => {
      result.current.startFlow();
    });
    // The projection resolved the failure to no visible block. The
    // engine's id happens to collide with a block id, but the hook must
    // trust the resolution and not re-derive a stop position from the
    // internal id — the sweep must not stop at an invented position.
    rerender({
      program: {
        ...snapshot(),
        error: {
          status: "error",
          kind: "TypeMismatch",
          command: 2,
          message: "type mismatch at 2",
        },
        errorBlockId: null,
      },
    });
    expect(result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2, kind: "chain" },
      { fid: 0, from: 2, to: 3, kind: "chain" },
    ]);
  });

  it("never stops at the internal node id the engine reported", () => {
    const { result, rerender } = renderHook(
      ({ program }: { program: ProgramSnapshot }) => useFlowGlow(program),
      { initialProps: { program: snapshot() } },
    );
    act(() => {
      result.current.startFlow();
    });
    // The engine blamed a hidden node (a print's hidden print node, an
    // `if`'s hidden condition compute): it is not a graph node, so the
    // animation must not truncate at some other block.
    rerender({
      program: {
        ...snapshot(),
        error: {
          status: "error",
          kind: "TypeMismatch",
          command: 42,
          message: "type mismatch at 42",
        },
        errorBlockId: null,
      },
    });
    expect(result.current.flow?.edges).toHaveLength(2);
  });

  it("clears a stale target when the failure is dismissed", () => {
    const { result, rerender } = renderHook(
      ({ program }: { program: ProgramSnapshot }) => useFlowGlow(program),
      { initialProps: { program: snapshot() } },
    );
    act(() => {
      result.current.startFlow();
    });
    rerender({ program: { ...snapshot(), errorBlockId: 2 } });
    expect(result.current.flow?.edges).toHaveLength(1);
    // The failure was dismissed: the target is gone, so the animation
    // is no longer held at a block that is not failing anymore.
    rerender({ program: { ...snapshot(), errorBlockId: null } });
    expect(result.current.flow?.edges).toHaveLength(2);
  });

  it("cleans its timer when it unmounts", () => {
    const { result, unmount } = renderHook(() => useFlowGlow(snapshot()));
    act(() => {
      result.current.startFlow();
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
