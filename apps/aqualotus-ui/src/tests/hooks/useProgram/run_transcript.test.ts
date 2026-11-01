/**
 * Console transcript contract for `applyRunStatus` — pure state rules.
 *
 * The wire contract these rules encode (probed against the shipped WASM
 * in `docs/INCREMENTAL_CONSOLE_OUTPUT_LIMITATION.md`): the
 * `waiting_input` and `error` envelopes carry no printed lines today,
 * and the `ok` envelope carries the session's full accumulated array.
 *
 * Each rule is written so an engine change that starts reporting output
 * on pause/error envelopes lands in the console without any UI change —
 * these tests hold the contract in place until then, mocking only the
 * hypothetical enriched envelopes, never the engine itself.
 */

import { describe, expect, it } from "vitest";
import { EMPTY, applyRunStatus } from "../../../hooks/program_state";
import type { RunStatus } from "../../../lib/optilotus";

function okStatus(printed: readonly string[]): RunStatus {
  return {
    status: "ok",
    steps: 1,
    prints: printed.length,
    printed: [...printed],
    returned: null,
  };
}

const waiting: RunStatus = {
  status: "waiting_input",
  command: 5,
  ty: "int32",
};

const failure: RunStatus = {
  status: "error",
  kind: "InputParse",
  command: 5,
  message: 'input parse error at 5: invalid int32 input "abc"',
  detail: 'invalid int32 input "abc"',
};

describe("the console transcript under run statuses", () => {
  it("the finished report replaces the window whole — repeats never duplicate lines", () => {
    const first = applyRunStatus(EMPTY, okStatus(["hello"]), 1.2);
    expect(first.runPrinted).toEqual(["hello"]);
    // The same terminal envelope delivered again (a rerender path, a
    // re-apply) must not stack onto the transcript.
    const second = applyRunStatus(first, okStatus(["hello"]), 1.2);
    expect(second.runPrinted).toEqual(["hello"]);
    // A resumed session's final report is an accumulated array too: it
    // replaces the window instead of appending onto what was shown.
    const grown = applyRunStatus(
      { ...second, runPrinted: ["hello", "hello2", "hello3"] },
      okStatus(["hello", "hello2", "hello3"]),
      2.4,
    );
    expect(grown.runPrinted).toEqual(["hello", "hello2", "hello3"]);
  });

  it("waiting_input keeps the transcript and prompts without touching the console", () => {
    const paused = applyRunStatus(
      { ...EMPTY, runPrinted: ["hello"] },
      waiting,
      1.2,
    );
    // Nothing is appended (the pause envelope reports nothing) and
    // nothing is cleared (a pause must never hide shown output).
    expect(paused.runPrinted).toEqual(["hello"]);
    expect(paused.pendingInput).toEqual({ command: 5, ty: "int32" });
    expect(paused.running).toBe(false);
    expect(paused.error).toBeNull();
  });

  it("error preserves every line reported before the failure and clears the prompt", () => {
    const failed = applyRunStatus(
      { ...EMPTY, runPrinted: ["hello"] },
      failure,
      1.2,
    );
    expect(failed.runPrinted).toEqual(["hello"]);
    expect(failed.pendingInput).toBeNull();
    expect(failed.run?.status).toBe("error");
    expect(failed.error?.kind).toBe("InputParse");
    expect(failed.errorFunctionId).toBeNull();
  });

  it("a fresh session starts with an empty console from the empty snapshot", () => {
    expect(EMPTY.runPrinted).toEqual([]);
    const paused = applyRunStatus(EMPTY, waiting, 0);
    expect(paused.runPrinted).toEqual([]);
    expect(paused.pendingInput).toEqual({ command: 5, ty: "int32" });
  });
});
