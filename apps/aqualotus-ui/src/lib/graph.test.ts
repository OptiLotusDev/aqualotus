import { describe, expect, it } from "vitest";
import { planChainAll } from "./graph";

describe("planChainAll", () => {
  it("chains orphan blocks head-to-tail and establishes the entry", () => {
    const plan = planChainAll(
      [
        { id: 1, next: null },
        { id: 2, next: null },
        { id: 3, next: null },
      ],
      null,
    );
    // The tail already has no successor, so no edit is needed for it.
    expect(plan).toEqual({
      edits: [
        { id: 1, next: 2 },
        { id: 2, next: 3 },
      ],
      entry: { type: "set", entry: 1 },
    });
  });

  it("keeps a live entry and appends the orphans after the tail", () => {
    const plan = planChainAll(
      [
        { id: 1, next: 2 },
        { id: 2, next: null },
        { id: 3, next: null },
      ],
      1,
    );
    expect(plan).toEqual({
      edits: [{ id: 2, next: 3 }],
      entry: { type: "keep" },
    });
  });

  it("skips the commands that belong to an `if` branch", () => {
    // The engine runs a branch member from the `if` itself, so chaining
    // it into the main chain as well would execute it twice.
    const plan = planChainAll(
      [
        { id: 1, next: null },
        {
          id: 2,
          next: null,
          then_body: [3, 4],
          else_body: [],
        },
        { id: 3, next: null },
        { id: 4, next: null },
      ],
      null,
    );
    expect(plan).toEqual({
      edits: [{ id: 1, next: 2 }],
      entry: { type: "set", entry: 1 },
    });
  });

  it("returns null when there is nothing to connect", () => {
    expect(planChainAll([], null)).toBeNull();
    expect(
      planChainAll([{ id: 1, next: null }], 1),
    ).toBeNull();
  });
});
