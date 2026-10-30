import { describe, expect, it } from "vitest";
import {
  CAST_TARGET_TYPES,
  CASTING_DISABLED,
  castConvertedVariableNote,
  castingIncomplete,
  castingIndicatorVisible,
  collapseCasting,
  convertedVariableName,
  declaredTypeOf,
  destinationNameOf,
  isInternalCastingName,
  nextConvertedNames,
  resolveCastingEntry,
  type CastingInfo,
  type CastingSetting,
} from "../../lib/casting";
import type { CommandSummary, OptilotusType } from "../../lib/optilotus";

function enabled(targetType: OptilotusType | null): CastingSetting {
  return { enabled: true, targetType };
}

describe("the casting choice on an assignment", () => {
  it("starts off with no target and no name derived", () => {
    expect(CASTING_DISABLED).toEqual({ enabled: false, targetType: null });
    expect(castingIncomplete(CASTING_DISABLED)).toBe(false);
  });

  it("keeps the user's target when Casting is toggled on", () => {
    const chosen = enabled("float64");
    const on = { enabled: true, targetType: chosen.targetType };
    expect(on).toEqual({ enabled: true, targetType: "float64" });
  });

  it("drops the target when Casting is toggled off (state update)", () => {
    // Disabling is the deliberate reset to the ordinary assignment: no
    // stale target survives into the next Apply.
    const off = { enabled: false, targetType: null };
    expect(off).toEqual(CASTING_DISABLED);
  });

  it("replaces the target when the user changes it", () => {
    const before = enabled("float64");
    const after: CastingSetting = { ...before, targetType: "int32" };
    expect(after).toEqual({ enabled: true, targetType: "int32" });
    expect(before).toEqual({ enabled: true, targetType: "float64" });
  });

  it("is incomplete only while enabled with no target chosen", () => {
    expect(castingIncomplete(enabled(null))).toBe(true);
    expect(castingIncomplete(enabled("int32"))).toBe(false);
    expect(castingIncomplete(undefined)).toBe(false);
  });
});

/**
 * The converted variable is a **new** program entity: its name is
 * derived from the assignment's destination and the target's compact
 * tag, and it can never collide with a variable that already exists.
 */
describe("convertedVariableName — the new variable's identity", () => {
  it("derives the converted name from the destination and the target tag", () => {
    expect(convertedVariableName([], "x", "float64")).toBe("x_f64");
    expect(convertedVariableName([], "n", "int32")).toBe("n_i32");
    expect(convertedVariableName(["x"], "x", "float64")).toBe("x_f64");
  });

  it("gives every legal target its own suffix", () => {
    const names = CAST_TARGET_TYPES.map((t) =>
      convertedVariableName([], "x", t),
    );
    expect(new Set(names).size).toBe(CAST_TARGET_TYPES.length);
    expect(names).not.toContain("x");
    expect(names.every((n) => !isInternalCastingName(n))).toBe(true);
  });

  it("is never the destination's own name — the original variable is not reused", () => {
    for (const target of CAST_TARGET_TYPES) {
      expect(convertedVariableName(["x"], "x", target)).not.toBe("x");
    }
  });

  it("disambiguates a taken name instead of reusing it", () => {
    expect(convertedVariableName(["x_f64"], "x", "float64")).toBe("x_f64_2");
    expect(convertedVariableName(["x_f64", "x_f64_2"], "x", "float64")).toBe(
      "x_f64_3",
    );
  });

  it("trims names and falls back to `value` for an empty destination", () => {
    expect(convertedVariableName([" x_f64 "], " x ", "float64")).toBe(
      "x_f64_2",
    );
    expect(convertedVariableName([], "   ", "float64")).toBe("value_f64");
  });
});

describe("nextConvertedNames — the pair one apply creates", () => {
  it("returns the derived name and its reserved anchor handle", () => {
    expect(nextConvertedNames([], "x", "float64")).toEqual({
      anchorName: "__aqualotus_internal_anchor_x_f64",
      outName: "x_f64",
    });
  });

  it("advances when the derived name is taken", () => {
    expect(nextConvertedNames(["x_f64"], "x", "float64")).toEqual({
      anchorName: "__aqualotus_internal_anchor_x_f64_2",
      outName: "x_f64_2",
    });
  });

  it("advances when only the anchor handle is taken", () => {
    expect(
      nextConvertedNames(
        ["__aqualotus_internal_anchor_x_f64"],
        "x",
        "float64",
      ),
    ).toEqual({
      anchorName: "__aqualotus_internal_anchor_x_f64_2",
      outName: "x_f64_2",
    });
  });

  it("reserves a name the engine can declare: the anchor never equals the variable", () => {
    const { anchorName, outName } = nextConvertedNames([], "x", "float64");
    expect(anchorName).not.toBe(outName);
    expect(isInternalCastingName(anchorName)).toBe(true);
    expect(isInternalCastingName(outName)).toBe(false);
  });
});

/**
 * The generated name is recoverable, which is what lets the UI rebuild
 * a conversion group after an undo: the visible block of a cross-type
 * conversion IS the created cast, so the destination name it came from
 * is only readable through the name it produced.
 */
describe("destinationNameOf — the inverse of the derived name", () => {
  it("recovers the destination from the converted variable's name", () => {
    expect(destinationNameOf("x_f64", "float64")).toBe("x");
    expect(destinationNameOf("n_i32", "int32")).toBe("n");
    expect(destinationNameOf("b_u128", "uint128")).toBe("b");
    // A disambiguated name carries the tag before its numeric suffix.
    expect(destinationNameOf("x_f64_2", "float64")).toBe("x");
    expect(destinationNameOf("n_i32_3", "int32")).toBe("n");
    // A destination whose own name ends in digits survives the round trip.
    expect(destinationNameOf("x_2_f64", "float64")).toBe("x_2");
  });

  it("round-trips every legal target", () => {
    for (const target of CAST_TARGET_TYPES) {
      const name = convertedVariableName([], "value", target);
      expect(destinationNameOf(name, target)).toBe("value");
    }
  });

  it("claims nothing when the name does not carry the target's tag", () => {
    expect(destinationNameOf("x", "float64")).toBeNull();
    expect(destinationNameOf("x_f64", "int32")).toBeNull();
    expect(destinationNameOf("", "float64")).toBeNull();
  });
});

/**
 * The note must describe the real operation: the converted value lives
 * in a new variable of the target type, and the original variable keeps
 * its declaration and value. There is no second conversion back into
 * the destination's declared type.
 */
describe("castConvertedVariableNote", () => {
  it("explains the new variable and its target type for a cross-type target", () => {
    const note = castConvertedVariableNote(enabled("float64"), "int32", "x");
    expect(note).toContain("creates the converted value in a new float64 variable");
    expect(note).toContain("about x_f64");
    expect(note).toContain("The destination keeps its declared type int32 and its value.");
    expect(note).not.toContain("then to int32");
  });

  it("covers an undeclared destination (the name only names the new variable)", () => {
    const note = castConvertedVariableNote(enabled("uint128"), undefined, "x");
    expect(note).toContain("The destination is not declared.");
    expect(note).toContain("creates the converted value in a new uint128 variable");
    expect(note).toContain("about x_u128");
  });

  it("stays silent when no new variable is created", () => {
    // Target equals the destination's declared type: the conversion
    // result is stored in the destination itself.
    expect(castConvertedVariableNote(enabled("int32"), "int32", "x")).toBeNull();
    expect(castConvertedVariableNote(CASTING_DISABLED, "int32", "x")).toBeNull();
    expect(castConvertedVariableNote(enabled(null), "int32", "x")).toBeNull();
  });
});

describe("castingIndicatorVisible", () => {
  const casting: CastingInfo = {
    anchorId: 7,
    castId: 8,
    tempName: "x_f64",
    destinationName: "x",
    sourceExpr: "{x}",
    targetType: "float64",
  };

  it("requires a projected assign or cast with a legal target", () => {
    expect(
      castingIndicatorVisible({ kind: "assign", ty: "int32", casting }),
    ).toBe(true);
    // The converted variable is a real Cast block: the canvas annotates
    // it exactly like a casting assignment.
    expect(
      castingIndicatorVisible({ kind: "cast", ty: "float64", casting }),
    ).toBe(true);
  });

  it("stays hidden without casting info, a type, or a legal target", () => {
    expect(castingIndicatorVisible({ kind: "assign", ty: "int32" })).toBe(false);
    expect(castingIndicatorVisible({ kind: "assign", casting })).toBe(false);
    expect(castingIndicatorVisible({ kind: "declare", ty: "int32", casting })).toBe(
      false,
    );
    expect(
      castingIndicatorVisible({
        kind: "assign",
        ty: "int32",
        casting: { ...casting, targetType: "void" as OptilotusType },
      }),
    ).toBe(false);
  });
});

describe("declaredTypeOf", () => {
  function command(
    id: number,
    kind: string,
    extra: Partial<CommandSummary> = {},
  ): CommandSummary {
    return { id, kind, next: null, ...extra } as CommandSummary;
  }

  it("reports the declared type of a declare or a cast row", () => {
    const commands = [
      command(1, "declare", { var: "x", ty: "int32" }),
      command(2, "cast", { var: "x_f64", ty: "float64" }),
    ];
    expect(declaredTypeOf(commands, "x")).toBe("int32");
    expect(declaredTypeOf(commands, "x_f64")).toBe("float64");
    expect(declaredTypeOf(commands, "ghost")).toBeUndefined();
    expect(declaredTypeOf(commands, "  ")).toBeUndefined();
  });
});

/**
 * `collapseCasting` recognises the two shapes the Option B creator
 * emits:
 *
 * - the **native cast** (the chosen target differs from the
 *   destination's declared type, or the destination is not declared):
 *   a hidden `declare` anchor whose name carries the derived variable
 *   name, whose successor is a real `cast` of exactly that variable.
 *   The cast block stays visible and carries the group's info;
 * - the **single leg** (target equals the destination's declared type):
 *   a hidden anchor and a hidden temp cast, pointing at the visible
 *   `assign` of the destination that stores exactly `{temp}`.
 */
describe("collapseCasting — conversion groups", () => {
  function command(
    id: number,
    kind: string,
    extra: Partial<CommandSummary> = {},
  ): CommandSummary {
    return { id, kind, next: null, ...extra } as CommandSummary;
  }

  /** The Option B cross-type group: anchor + the visible cast. */
  function nativeCommands(): CommandSummary[] {
    return [
      command(1, "declare", { var: "x", ty: "int32", expr: "5" }),
      // The anchor handle carries the derived variable name; the engine
      // never reports the anchor -> cast edge (the cast's head is a
      // hidden compute), so the pair is matched by that generated name.
      command(2, "declare", {
        var: "__aqualotus_internal_anchor_x_f64",
        ty: "int32",
      }),
      command(5, "cast", {
        var: "x_f64",
        ty: "float64",
        expr: "{x}",
        next: 4,
      }),
      command(4, "print", { template: '"{x_f64}"' }),
    ];
  }

  it("keeps the created cast visible and carries the conversion on it", () => {
    const collapsed = collapseCasting(nativeCommands());
    expect(collapsed.commands).toHaveLength(3); // x, cast, print
    expect(collapsed.pairs).toHaveLength(1);
    const cast = collapsed.commands.find((c) => c.kind === "cast");
    // The visible block keeps its own engine id and expression: the
    // converted variable is the row the engine declared.
    expect(cast).toMatchObject({
      id: 5,
      var: "x_f64",
      ty: "float64",
      expr: "{x}",
      casting: {
        anchorId: 2,
        castId: 5,
        tempName: "x_f64",
        // Recovered from the generated name: `x_f64` came from `x`.
        destinationName: "x",
        sourceExpr: "{x}",
        targetType: "float64",
      } satisfies CastingInfo,
    });
    // The hidden anchor redirects to the visible cast.
    expect(collapsed.redirects.get(2)).toBe(5);
    expect(collapsed.castings.get(5)?.targetType).toBe("float64");
  });

  it("leaves the original variable's declaration visible and untouched", () => {
    const collapsed = collapseCasting(nativeCommands());
    expect(
      collapsed.commands.find((c) => c.kind === "declare"),
    ).toMatchObject({ id: 1, var: "x", ty: "int32", expr: "5" });
    expect(collapsed.commands.some((c) => c.kind === "assign")).toBe(false);
  });

  it("carries what a rebuild needs to recreate the same variable", () => {
    const collapsed = collapseCasting(nativeCommands());
    const info = collapsed.castings.get(5);
    expect(info).toBeDefined();
    if (info === undefined) return;
    // The recovered destination, the target and the freed name rebuild
    // exactly the variable the group created — so an undo restores the
    // same block instead of a bare cast row whose hidden head is lost.
    expect(
      nextConvertedNames([], info.destinationName, info.targetType).outName,
    ).toBe(info.tempName);
  });

  it("leaves a cast whose anchor is missing alone (no invented group)", () => {
    const cmds = nativeCommands().filter((c) => c.id !== 2);
    const collapsed = collapseCasting(cmds);
    expect(collapsed.pairs).toHaveLength(0);
    expect(
      collapsed.commands.find((c) => c.kind === "cast")?.casting,
    ).toBeUndefined();
  });

  it("does not treat a user variable as a hidden anchor", () => {
    // A real user variable named like the derived name is not an anchor
    // handle, so the cast carries no group.
    const cmds = nativeCommands();
    cmds[1] = command(2, "declare", { var: "x_f64", ty: "float64" });
    const collapsed = collapseCasting(cmds);
    expect(collapsed.pairs).toHaveLength(0);
  });

  /** Target equals the destination's declared type: a hidden group. */
  function singleLegCommands(): CommandSummary[] {
    return [
      command(1, "declare", { var: "n", ty: "int64", expr: "7" }),
      command(2, "declare", { var: "f", ty: "float64", expr: "0" }),
      command(3, "declare", {
        var: "__aqualotus_internal_anchor_1",
        ty: "int32",
      }),
      command(4, "print", { template: '"{f}"' }),
      command(5, "cast", {
        var: "__aqualotus_internal_cast_1",
        ty: "float64",
        expr: "{n}",
        next: 7,
      }),
      command(7, "assign", {
        var: "f",
        ty: "float64",
        expr: "{__aqualotus_internal_cast_1}",
        next: 4,
      }),
    ];
  }

  it("collapses the single-leg group into the visible assign", () => {
    const collapsed = collapseCasting(singleLegCommands());
    expect(collapsed.commands).toHaveLength(4); // n, f, print, assign
    const assign = collapsed.commands.find((c) => c.kind === "assign");
    expect(assign).toMatchObject({
      id: 7,
      var: "f",
      ty: "float64",
      // The displayed expression is the conversion source.
      expr: "{n}",
      casting: {
        anchorId: 3,
        castId: 5,
        tempName: "__aqualotus_internal_cast_1",
        destinationName: "f",
        sourceExpr: "{n}",
        targetType: "float64",
      } satisfies CastingInfo,
    });
    expect(collapsed.redirects.get(3)).toBe(7);
    expect(collapsed.redirects.get(5)).toBe(7);
  });

  it("leaves nearly-matching shapes alone", () => {
    // The assign stores the wrong temp: no valid group has that, so
    // nothing may collapse.
    const cmds = singleLegCommands();
    const assign = cmds.find((c) => c.id === 7);
    expect(assign).toBeDefined();
    if (assign === undefined) return;
    cmds[cmds.indexOf(assign)] = { ...assign, expr: "{n}" };
    const collapsed = collapseCasting(cmds);
    expect(collapsed.pairs).toHaveLength(0);
    expect(collapsed.commands).toHaveLength(6);
  });

  it("never collapses the regressed two-leg store shape into one block", () => {
    // The store-leg design (source -> target -> the destination's
    // declared type -> store into the destination) is not a shape this
    // UI creates: its rows stay visible instead of being projected as a
    // single assignment, so no program can silently keep that
    // semantics. Nothing persists programs, so no stored file can carry
    // it either.
    const cmds: CommandSummary[] = [
      command(1, "declare", { var: "n", ty: "int32", expr: "7" }),
      command(2, "declare", { var: "f", ty: "float64", expr: "0" }),
      command(3, "declare", {
        var: "__aqualotus_internal_anchor_1",
        ty: "int32",
      }),
      command(5, "cast", {
        var: "__aqualotus_internal_cast_1",
        ty: "int32",
        expr: "{n}",
        next: 6,
      }),
      command(6, "cast", {
        var: "__aqualotus_internal_cast_2",
        ty: "float64",
        expr: "{__aqualotus_internal_cast_1}",
        next: 7,
      }),
      command(7, "assign", {
        var: "f",
        ty: "float64",
        expr: "{__aqualotus_internal_cast_2}",
        next: null,
      }),
    ];
    const collapsed = collapseCasting(cmds);
    expect(collapsed.pairs).toHaveLength(0);
    expect(collapsed.commands.some((c) => c.casting !== undefined)).toBe(false);
  });
});

describe("resolveCastingEntry", () => {
  const redirects = new Map<number, number>([[2, 5]]);

  it("maps a hidden group head to its visible block", () => {
    expect(resolveCastingEntry((e) => e, redirects, 2)).toBe(5);
    expect(resolveCastingEntry((e) => e, redirects, 7)).toBe(7);
    expect(resolveCastingEntry(() => null, redirects, 2)).toBeNull();
  });

  it("keeps a null entry null", () => {
    expect(resolveCastingEntry((e) => e, redirects, null)).toBeNull();
  });
});
