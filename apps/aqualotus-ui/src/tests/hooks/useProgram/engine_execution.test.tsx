/**
 * UI hook <-> real engine integration tests: execution path.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { setup, connectAll, type Api } from "./engine_support";
import { resetRealEngine, useRealEngine } from "../../../test-support/realEngine";
import type { CommandSpec } from "../../../lib/optilotus";
import type { CommandDraft } from "../../../lib/program";

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

function declareDraft(name: string, init = "1"): CommandDraft {
  return { kind: "declare", name, ty: "int32", init };
}

describe("PARITY-022 — the UI run path produces the engine's output", () => {
  it("shows the printed output of a real run", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "41"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "{n} + 1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{n}"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["42"]);
    expect(run.prints).toBe(1);
    expect(api().snapshot.actionError).toBe("");
  });

  it("surfaces a typed engine error and attributes it to no block", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "1"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: '"{n}"' });
    });
    connectAll(api, 0);
    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("error");
    if (run?.status !== "error") return;
    expect(run.kind).toBe("TypeMismatch");
    expect(api().snapshot.actionError).toContain("TypeMismatch");
    expect(api().snapshot.error?.command).toBe(run.command);
    expect(api().snapshot.errorBlockId).toBeNull();
    expect(api().snapshot.errorFunctionId).toBeNull();
  });
});

/**
 * printSpec builds the full wire `CommandSpec` for an `if` body spec,
 * mirroring the shape `optilotus_if` expects (engine_branching.test.tsx).
 */
function printSpec(template: string): CommandSpec {
  return {
    kind: "print",
    var: null,
    ty: null,
    access: null,
    init: null,
    expr: null,
    template,
    to: null,
  };
}

function inputDraft(
  name: string | undefined,
  ty: "int32" | "int64",
): CommandDraft {
  return name === undefined ? { kind: "input", ty } : { kind: "input", ty, name };
}

/**
 * The resumable console lifecycle: one persistent transcript across the
 * run's segments, pauses and terminal states.
 *
 * Wire reality (probed, see docs/INCREMENTAL_CONSOLE_OUTPUT_LIMITATION.md):
 * the `waiting_input` envelope carries no printed lines — the engine
 * reports the session's accumulated output only when it finishes. The
 * tests below pin the console state the wire actually delivers at every
 * step; the state contract itself (pause/error keep the transcript,
 * completion replaces it) is pinned in `run_transcript.test.ts` and the
 * Runner tests, so an engine that starts reporting output on pauses
 * lands in the console with no further UI change.
 */
describe("PARITY-024 — the console across resumable input pauses", () => {
  it("waits twice, then reports the whole transcript once, exactly in order", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello"' });
    });
    act(() => {
      api().addCommand(0, inputDraft("n", "int32"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello2"' });
    });
    act(() => {
      api().addCommand(0, inputDraft("n1", "int64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello3"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });

    // First pause: the console is live and empty. The engine reported
    // no lines with the pause envelope (wire contract), so the console
    // honestly shows what it was told: nothing — yet.
    const firstPause = api().snapshot;
    expect(firstPause.run).toBeNull();
    expect(firstPause.runPrinted).toEqual([]);
    expect(firstPause.pendingInput?.ty).toBe("int32");

    act(() => {
      api().provideInput("5");
    });

    // Second pause: the console stays open, the prompt moves on to the
    // next input block, and — still by wire contract — no lines have
    // been handed over between the pauses.
    const secondPause = api().snapshot;
    expect(secondPause.run).toBeNull();
    expect(secondPause.runPrinted).toEqual([]);
    expect(secondPause.pendingInput?.ty).toBe("int64");
    expect(secondPause.pendingInput?.command).not.toBe(
      firstPause.pendingInput?.command,
    );

    act(() => {
      api().provideInput("7");
    });

    // Completion: the engine's accumulated array is the transcript —
    // exactly once, in execution order.
    const done = api().snapshot;
    expect(done.run?.status).toBe("ok");
    expect(done.runPrinted).toEqual(["hello", "hello2", "hello3"]);
    if (done.run !== null && done.run.status === "ok") {
      // The transcript and the finished envelope agree: no duplication.
      expect(done.runPrinted).toEqual(done.run.printed);
      expect(done.run.printed).toHaveLength(3);
    }

    // The session is over: a stray line changes nothing.
    act(() => {
      api().provideInput("9");
    });
    expect(api().snapshot.pendingInput).toBeNull();
    expect(api().snapshot.runPrinted).toEqual(["hello", "hello2", "hello3"]);
  });

  it("a new run starts a fresh console and a fresh session after any outcome", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    for (const draft of [
      { kind: "print", template: '"hello"' } as CommandDraft,
      inputDraft("n", "int32"),
      { kind: "print", template: '"hello2"' } as CommandDraft,
      inputDraft("n1", "int64"),
      { kind: "print", template: '"hello3"' } as CommandDraft,
    ]) {
      act(() => {
        api().addCommand(0, draft);
      });
    }
    connectAll(api, 0);

    // Run 1 completes fully.
    act(() => {
      api().run();
    });
    act(() => {
      api().provideInput("5");
    });
    act(() => {
      api().provideInput("7");
    });
    expect(api().snapshot.runPrinted).toEqual([
      "hello",
      "hello2",
      "hello3",
    ]);

    // Run 2: a fresh console from the very first step. No line of run 1
    // survives into the new session, and the first prompt returns.
    act(() => {
      api().run();
    });
    const restarted = api().snapshot;
    expect(restarted.runPrinted).toEqual([]);
    expect(restarted.run).toBeNull();
    expect(restarted.pendingInput?.ty).toBe("int32");
    act(() => {
      api().provideInput("5");
    });
    // …and the fresh run completes on its own output, not the mixture.
    act(() => {
      api().provideInput("7");
    });
    expect(api().snapshot.runPrinted).toEqual(["hello", "hello2", "hello3"]);
  });

  it("cancellation drops the pending prompt without a stale resume", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello"' });
    });
    act(() => {
      api().addCommand(0, inputDraft("n", "int32"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello2"' });
    });
    act(() => {
      api().addCommand(0, inputDraft("n1", "int64"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello3"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });
    act(() => {
      api().provideInput("5");
    });
    expect(api().snapshot.pendingInput?.ty).toBe("int64");

    // The user abandons the second pause. The prompt is gone, no
    // further input is accepted, and the console holds exactly what the
    // engine reported (nothing yet — wire contract), not a stale echo.
    act(() => {
      api().cancelRun();
    });
    expect(api().snapshot.pendingInput).toBeNull();
    expect(api().snapshot.runPrinted).toEqual([]);
    act(() => {
      api().provideInput("7");
    });
    // The session is dead: feeding it does nothing and reports no fake
    // completion.
    expect(api().snapshot.pendingInput).toBeNull();
    expect(api().snapshot.run).toBeNull();

    // A cancellation never blocks the next run.
    act(() => {
      api().run();
    });
    expect(api().snapshot.pendingInput?.ty).toBe("int32");
  });

  it("an input parse failure stops the run and keeps the console untouched", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello"' });
    });
    act(() => {
      api().addCommand(0, inputDraft("n", "int32"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"hello2"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });
    expect(api().snapshot.pendingInput).not.toBeNull();

    act(() => {
      api().provideInput("not-an-int");
    });

    // The failure is the input block's own, the prompt is gone, and the
    // console shows nothing but what the engine reported before the
    // failure — nothing was reported (wire contract), so nothing may
    // appear, and nothing was erased either.
    const failed = api().snapshot;
    expect(failed.run?.status).toBe("error");
    expect(failed.error?.kind).toBe("InputParse");
    expect(failed.errorBlockId).not.toBeNull();
    expect(failed.pendingInput).toBeNull();
    expect(failed.runPrinted).toEqual([]);

    // No command after the failed input executes: the session is dead,
    // so a later line is refused up front and changes nothing.
    act(() => {
      api().provideInput("5");
    });
    expect(api().snapshot.pendingInput).toBeNull();
    expect(api().snapshot.run?.status).toBe("error");
    expect(api().snapshot.runPrinted).toEqual([]);
  });

  it("a run without input reports its output the moment it finishes", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("n", "41"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "n", expr: "{n} + 1" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{n}"' });
    });
    connectAll(api, 0);

    act(() => {
      api().run();
    });

    const run = api().snapshot.run;
    expect(run?.status).toBe("ok");
    if (run?.status !== "ok") return;
    expect(run.printed).toEqual(["42"]);
    // The console mirrors the engine's report exactly: the single
    // output surface shows these lines once.
    expect(api().snapshot.runPrinted).toEqual(run.printed);
    expect(api().snapshot.pendingInput).toBeNull();
  });

  /**
   * Mixed execution (task example 3): declarations, assignments,
   * conditionals and two inputs around the pauses — the engine runs the
   * real commands; the console's final transcript is exactly the
   * executed program's output, in order.
   */
  it("runs a mixed program of assigns, branches and two inputs end to end", async () => {
    const { result } = await setup();
    const api = (): Api => result.current;

    act(() => {
      api().addCommand(0, declareDraft("x", "5"));
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"Step 1"' });
    });
    act(() => {
      api().addCommand(0, inputDraft("n", "int32"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x} + {n}" });
    });
    act(() => {
      api().addCommand(0, {
        kind: "if",
        condition: "{x} > 10",
        then: [printSpec('"Step 2: High"')],
        else: [printSpec('"Step 2: Low"')],
      });
    });
    act(() => {
      api().addCommand(0, inputDraft("m", "int32"));
    });
    act(() => {
      api().addCommand(0, { kind: "assign", name: "x", expr: "{x} + {m}" });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"Final result"' });
    });
    act(() => {
      api().addCommand(0, { kind: "print", template: '"{x}"' });
    });
    connectAll(api, 0);

    // First pause; x = 5, waiting before "Step 1"'s successors run.
    act(() => {
      api().run();
    });
    expect(api().snapshot.pendingInput).not.toBeNull();
    expect(api().snapshot.runPrinted).toEqual([]);

    // n = 7 → x = 12 → the branch takes `then`.
    act(() => {
      api().provideInput("7");
    });
    expect(api().snapshot.pendingInput?.ty).toBe("int32");

    // m = 3 → x = 15 → "Final result", "15".
    act(() => {
      api().provideInput("3");
    });

    const done = api().snapshot;
    expect(done.run?.status).toBe("ok");
    expect(done.runPrinted).toEqual([
      "Step 1",
      "Step 2: High",
      "Final result",
      "15",
    ]);
  });
});
