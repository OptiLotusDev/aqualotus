import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFlowGlow } from "./useFlowGlow";
import type { ProgramSnapshot } from "./useProgram";
import { FLOW_LINK_MS } from "../lib/flow";

/**
 * The execution-flow model of the shell: which connections travel, in
 * which order, and when the visualisation is over. The bridge lookup
 * that seeds the chain is mocked — the UI never invents an order the
 * engine did not give it.
 */

vi.mock("../lib/optilotus", () => ({
  optilotus_getFunction: vi.fn(() => ({
    status: "ok",
    id: 0,
    name: "main",
    isMain: true,
    entry: 1,
    commandCount: 3,
  })),
}));

function snapshot(): ProgramSnapshot {
  return {
    functions: [{ id: 0, name: "main", isMain: true }],
    selectedId: 0,
    selected: null,
    commands: [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
      { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
      { id: 3, kind: "print", next: null, template: '"{n}"' },
    ],
    commandsByFunction: {
      0: [
        { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
        { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
        { id: 3, kind: "print", next: null, template: '"{n}"' },
      ],
    },
    selectedCommandId: null,
    run: null,
    running: false,
    durationMs: null,
    busy: false,
    actionError: "",
    commandErrorId: null,
    recoveryVar: null,
  };
}

describe("useFlowGlow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
      { fid: 0, from: 1, to: 2 },
      { fid: 0, from: 2, to: 3 },
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

  it("stops the travel at the command the engine blamed", () => {
    const { result, rerender } = renderHook(
      ({ program }: { program: ProgramSnapshot }) => useFlowGlow(program),
      { initialProps: { program: snapshot() } },
    );
    act(() => {
      result.current.startFlow();
    });
    // The engine failed at command 2: the connection that fed it ran,
    // the one after it did not.
    rerender({ program: { ...snapshot(), commandErrorId: 2 } });
    expect(result.current.flow?.edges).toEqual([
      { fid: 0, from: 1, to: 2 },
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
    // The head never reached its successor: no connection carried
    // anything, so none of them may travel.
    rerender({ program: { ...snapshot(), commandErrorId: 1 } });
    expect(result.current.flow?.edges).toEqual([]);
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
