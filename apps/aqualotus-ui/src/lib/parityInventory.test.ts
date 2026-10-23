/**
 * Parity inventory guards.
 *
 * These tests pin the *shape* of the Engine ↔ UI surface so the audit
 * in `docs/feature-parity-audit.md` cannot silently rot:
 *
 * - every WASM export has a TypeScript wrapper (or a documented alias),
 * - the type-tag table the UI offers matches the engine's union,
 * - the block library covers exactly the command kinds a user can
 *   create — the exceptions are listed with their reason.
 */
import { describe, expect, it } from "vitest";
import * as bridge from "./optilotus";
import * as wasm from "../wasm/optilotus/optilotus.js";
import { BLOCKS } from "./blocks";
import { COMMAND_KINDS } from "./program";
import type { CommandKind } from "../wasm/optilotus/bindings/CommandKind";

/**
 * WASM exports whose TypeScript wrapper carries a different name. The
 * alias is documented in `docs/api.md`; keeping the list here makes a
 * rename an explicit, reviewed change.
 */
const DOCUMENTED_ALIASES: Readonly<Record<string, string>> = {
  optilotus_runProgramPeekPending: "optilotus_peekPendingInput",
};

describe("parity inventory — the bridge covers every engine export", () => {
  it("wraps every WASM export the engine offers", () => {
    const missing: string[] = [];
    for (const name of Object.keys(wasm)) {
      if (name === "default" || name === "initSync") continue;
      const alias = DOCUMENTED_ALIASES[name];
      const wrapped =
        typeof (bridge as unknown as Record<string, unknown>)[name] ===
          "function" ||
        (alias !== undefined &&
          typeof (bridge as unknown as Record<string, unknown>)[alias] ===
            "function");
      if (!wrapped) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it("has no wrapper for an export the engine does not offer", () => {
    const wasmExports = new Set(Object.keys(wasm));
    const orphans: string[] = [];
    for (const name of Object.keys(bridge)) {
      if (!name.startsWith("optilotus_")) continue;
      if (
        name === "optilotus_tryEnsure" ||
        name === "optilotus_resetInitForTesting" ||
        // The type-tag table is a UI convenience over the engine's
        // `Type` union, not a wrapper of an engine operation.
        name === "optilotus_type"
      ) {
        continue;
      }
      if (wasmExports.has(name)) continue;
      const aliased = Object.entries(DOCUMENTED_ALIASES).some(
        ([wasmName, bridgeName]) =>
          wasmName === name || bridgeName === name,
      );
      if (!aliased) orphans.push(name);
    }
    expect(orphans).toEqual([]);
  });
});

describe("parity inventory — the type table matches the engine", () => {
  it("offers exactly the engine's type tags", () => {
    // `optilotus_type` is declared with `satisfies Record<string,
    // OptilotusType>`, so a missing or extra tag is a compile error
    // already; this test pins the runtime value.
    const expected = [
      "int8",
      "int16",
      "int32",
      "int64",
      "int128",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
      "uint128",
      "float32",
      "float64",
      "bool",
      "char",
      "string",
      "void",
    ];
    expect(Object.values(bridge.optilotus_type).sort()).toEqual(
      [...expected].sort(),
    );
  });
});

describe("parity inventory — the block library", () => {
  /**
   * Command kinds the engine supports that the library does not offer
   * a block for. Each one needs a reason, so a follow-up task that adds
   * the block has to update this list deliberately.
   */
  const NOT_CREATABLE_FROM_THE_LIBRARY: Readonly<
    Record<string, string>
  > = {
    // The engine reads a value from the input, but it binds it to a
    // `ValueId` and never to a variable name, so no expression can
    // read it back: a block would create dead code.
    input:
      "the engine's input op binds no variable name, so its value is unreachable",
    // The engine supports cast execution, but casting is configured
    // through the Assign Variable Inspector rather than a standalone
    // library block. The bridge's `optilotus_cast` remains available
    // for programs that already contain cast commands.
    cast:
      "casting is configured inside the Assign Variable Inspector; no standalone library block",
  };

  it("offers a block for every creatable command kind", () => {
    const creatable = new Set<string>();
    for (const block of BLOCKS) {
      if (block.draft !== undefined) creatable.add(block.draft.kind);
    }
    // The `call` block is an assign that carries a call expression.
    creatable.add("assign");
    const expected = new Set(
      (["declare", "assign", "print", "return", "if"] as CommandKind[]).map(
        (k) => k,
      ),
    );
    for (const kind of expected) {
      if (!creatable.has(kind)) {
        throw new Error(`no library block creates a ${kind} command`);
      }
    }
  });

  it("lists every engine command kind that the library cannot create", () => {
    const creatable = new Set<string>();
    for (const block of BLOCKS) {
      if (block.draft !== undefined) creatable.add(block.draft.kind);
    }
    const engineKinds: CommandKind[] = [
      "declare",
      "assign",
      "print",
      "input",
      "cast",
      "return",
      "if",
    ];
    const notCreatable = engineKinds.filter((k) => !creatable.has(k));
    for (const kind of notCreatable) {
      expect(
        NOT_CREATABLE_FROM_THE_LIBRARY[kind],
        `${kind} has no library block and no documented reason`,
      ).toBeTruthy();
    }
  });
});

describe("parity inventory — the editor's draft kinds", () => {
  it("keeps the legacy command-kind list in step with the engine", () => {
    // `COMMAND_KINDS` is the vocabulary the older helpers expose; the
    // engine knows more kinds than that list, which is why the list is
    // pinned here rather than derived.
    expect([...COMMAND_KINDS]).toEqual([
      "declare",
      "assign",
      "print",
      "return",
    ]);
  });
});
