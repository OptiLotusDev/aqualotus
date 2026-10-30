/**
 * Unit tests for the runtime-failure model.
 *
 * These tests prove the **UI's** mapping rules. They do not claim that
 * the engine supplies a particular mapping: the engine reports the id
 * of the internal IR node that failed, and the UI can only resolve
 * that id to a visible block when the node is the one a block owns.
 * The integration side of the same rules lives in
 * `hooks/useProgram.engine.test.tsx` (real engine).
 */
import { describe, expect, it } from "vitest";
import {
  errorFields,
  internalCommandOf,
  resolveErrorTarget,
  type UiRunError,
} from "../../lib/errors";

/** The visible blocks of two functions. */
const GRAPH = {
  0: [{ id: 1 }, { id: 3 }],
  1: [{ id: 7 }],
};

describe("resolveErrorTarget", () => {
  it("resolves an id that a visible block owns", () => {
    expect(resolveErrorTarget(GRAPH, 3)).toEqual({
      blockId: 3,
      functionId: 0,
    });
  });

  it("resolves a block of another function", () => {
    // A failure inside a called helper is reported with a node id of
    // the helper: the lookup spans every function.
    expect(resolveErrorTarget(GRAPH, 7)).toEqual({
      blockId: 7,
      functionId: 1,
    });
  });

  it("leaves an internal node id unresolved", () => {
    // The engine blames the node that failed, which for a print or a
    // cast is a hidden node of the block's group: no visible block
    // owns it, so the UI must not point at one.
    expect(resolveErrorTarget(GRAPH, 2)).toBeNull();
    expect(resolveErrorTarget(GRAPH, 99)).toBeNull();
  });

  it("leaves a failure without a node unresolved", () => {
    expect(resolveErrorTarget(GRAPH, null)).toBeNull();
  });

  it("leaves a deleted block unresolved", () => {
    // The block is gone: its id names nothing any more.
    expect(resolveErrorTarget({ 0: [{ id: 1 }] }, 3)).toBeNull();
  });

  it("leaves a failure in another package unresolved", () => {
    expect(resolveErrorTarget({}, 3)).toBeNull();
  });
});

describe("internalCommandOf", () => {
  it("reads the engine's node id", () => {
    const error: UiRunError = {
      status: "error",
      kind: "TypeMismatch",
      command: 42,
      message: "type mismatch at 42",
    };
    expect(internalCommandOf(error)).toBe(42);
  });

  it("is null for a failure that names no node", () => {
    const error: UiRunError = {
      status: "error",
      kind: "LoopLimit",
      command: null,
      message: "loop limit reached",
    };
    expect(internalCommandOf(error)).toBeNull();
    expect(internalCommandOf(null)).toBeNull();
  });
});

describe("errorFields", () => {
  it("keeps the kind-specific fields of a failure", () => {
    const error: UiRunError = {
      status: "error",
      kind: "UnknownVariable",
      command: 3,
      message: 'unknown variable "ghost" at 3',
      var: "ghost",
    };
    expect(errorFields(error)).toEqual([
      { label: "Variable", value: "ghost" },
    ]);
  });

  it("lists every field the engine sent", () => {
    const error: UiRunError = {
      status: "error",
      kind: "Arity",
      command: 3,
      message: "arity mismatch at 3",
      detail: "2 inputs",
      expected: "1 input",
      found: 2,
      value: 9,
      limit: 100,
      var: "x",
      function: "helper",
    };
    expect(errorFields(error)).toEqual([
      { label: "Detail", value: "2 inputs" },
      { label: "Value", value: "9" },
      { label: "Expected", value: "1 input" },
      { label: "Found", value: "2" },
      { label: "Limit", value: "100" },
      { label: "Variable", value: "x" },
      { label: "Function", value: "helper" },
    ]);
  });

  it("is empty for a failure without extras", () => {
    const error: UiRunError = {
      status: "error",
      kind: "InputEof",
      command: 1,
      message: "input EOF at 1",
    };
    expect(errorFields(error)).toEqual([]);
  });
});
