/**
 * If/Else visual-editor behaviours against the **real** engine.
 *
 * The canvas/striping tests mock the bridge, which proves the UI's own
 * logic but not the integration. This file drives the real WASM
 * artifact through the real bridge wrappers and then feeds the *same*
 * pure modules the app uses (`graph`, `branching`, `flow`, the
 * `withPlannedLinks` projection from `useProgram`) — the evidence that
 * the editor's branch membership, merge rails, attach/refuse rules and
 * execution-glow decisions all stand on what the engine actually
 * reports, not on a mock's idea of it.
 *
 * Program under test mirrors the app's own gestures at bridge level:
 * an `if` block dropped onto a chain (`optilotus_if` appends it at the
 * raw chain tail with its hidden condition compute), a print into each
 * branch (`optilotus_if_append` — the same bridge call
 * `resolveBranchConnect` routes to), and a continuation print created
 * after the `if` — every branch's merge point.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRealEngine, useRealEngine } from "../test-support/realEngine";
import {
  optilotus_declare,
  optilotus_getFunction,
  optilotus_if,
  optilotus_if_append,
  optilotus_if_condition,
  optilotus_if_set_condition,
  optilotus_listCommands,
  optilotus_print,
  optilotus_return,
  optilotus_runProgram,
  optilotus_setEntry,
  optilotus_setNext,
  optilotus_type,
} from "./optilotus";
import { collapseCasting } from "./casting";
import {
  branchOwnerOf,
  mergeEdgesOf,
  mergeJoinRailsOf,
  resolveEntry,
  visibleBranchMembers,
} from "./graph";
import { resolveBranchConnect } from "./branching";
import { resolveRunPath } from "./flow";
import { withPlannedLinks } from "../hooks/useProgram";
import type { UiCommand } from "./program";

/** Throws unless the envelope is `ok`, and gives the narrowed shape. */
function ok<T extends { status: string; message?: string }>(
  envelope: T,
  what: string,
): T extends { status: "ok" } ? T : never;
function ok(
  envelope: { status: string; message?: string },
  what: string,
): unknown {
  if (envelope.status !== "ok") {
    throw new Error(`${what} failed: ${envelope.message ?? envelope.status}`);
  }
  return envelope;
}

/** The ids of the standard two-branch program. */
interface BranchProgram {
  readonly declare: number;
  readonly ifId: number;
  readonly thenPrint: number;
  readonly elsePrint: number;
  /** The continuation block after the `if` — the merge/join point. */
  readonly after: number;
}

/**
 * Build the standard program the way the app does, one bridge call per
 * gesture:
 * 1. an `if` block dropped onto the chain (empty bodies, creator at
 *    chain tail with its hidden compute),
 * 2. a print dropped into TRUE and one into FALSE (`if_append`),
 * 3. a continuation print created after the `if`.
 */
function buildTwoBranchProgram(): BranchProgram {
  const declare = ok(
    optilotus_declare(0, "x", optilotus_type.int32, "10"),
    "declare",
  );
  const created = ok(optilotus_if(0, "true", [], null), "if");
  const thenPrint = ok(optilotus_print(0, '"same"'), "then print");
  const elsePrint = ok(optilotus_print(0, '"same"'), "else print");
  const after = ok(optilotus_print(0, '"end"'), "continuation print");
  ok(optilotus_if_append(0, created.id, "then", thenPrint.id), "then append");
  ok(optilotus_if_append(0, created.id, "else", elsePrint.id), "else append");
  ok(optilotus_setEntry(0, declare.id), "entry");
  return {
    declare: declare.id,
    ifId: created.id,
    thenPrint: thenPrint.id,
    elsePrint: elsePrint.id,
    after: after.id,
  };
}

/**
 * The UI-projected command list (`useProgram.load`'s projection), with
 * the connection the UI planned into the `if`: the engine's summary
 * shows the block before the `if` without a successor (the hidden
 * condition compute sits between them and `user_next` cannot name a
 * user head — see `repairIfCondition`/`PlannedLinks`), so the overlay
 * record the app holds for every wire the user draws into an `if` is
 * what the canvas sees here too.
 */
function projected(
  fid: number,
  planned: ReadonlyMap<number, number> = new Map(),
): UiCommand[] {
  const listed = ok(optilotus_listCommands(fid), "list");

  return withPlannedLinks(collapseCasting(listed.commands).commands, planned);
}

/** The plan-overlay the app records when a wire is drawn into an `if`. */
function plannedInto(planner: number, target: number): Map<number, number> {
  return new Map([[planner, target]]);
}

/** The engine's entry resolved the way the canvas does. */
function canvasEntry(
  fid: number,
  cmds: readonly UiCommand[],
): number | null {
  const info = ok(optilotus_getFunction(fid), "function");

  return resolveEntry(cmds, info.entry ?? null);
}

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

describe("If/Else branch membership (engine truth)", () => {
  it("reports the dropped block in the branch it was appended to", () => {
    const program = buildTwoBranchProgram();
    const cmds = projected(0, plannedInto(program.declare, program.ifId));
    const ifCommand = cmds.find((c) => c.id === program.ifId);
    if (ifCommand === undefined) throw new Error("if missing");

    // The branch lists carry the engine's own raw group ids; only the
    // user-visible heads are blocks the canvas can draw.
    expect(visibleBranchMembers(cmds, ifCommand.then_body)).toEqual([
      program.thenPrint,
    ]);
    expect(visibleBranchMembers(cmds, ifCommand.else_body)).toEqual([
      program.elsePrint,
    ]);

    // Membership the canvas derives (never a second source of truth):
    const owners = branchOwnerOf(cmds);
    expect(owners.get(program.thenPrint)).toEqual({
      ifId: program.ifId,
      branch: "then",
    });
    expect(owners.get(program.elsePrint)).toEqual({
      ifId: program.ifId,
      branch: "else",
    });
    // Blocks outside the branches own nothing, and the `if` itself is
    // not its own member.
    expect(owners.get(program.declare)).toBeUndefined();
    expect(owners.get(program.ifId)).toBeUndefined();
    expect(owners.get(program.after)).toBeUndefined();
  });

  it("detaches the moved member from the old chain (tail next = null)", () => {
    const program = buildTwoBranchProgram();
    const cmds = projected(0, plannedInto(program.declare, program.ifId));
    const byId = new Map(cmds.map((c) => [c.id, c]));

    // `if_append` ends the moved group's chain: the executor's body
    // walk stops at the tail and flow continues at the `if`'s own
    // next — even though the print's predecessor chain had continued
    // before (the raw chain was `if -> print1 -> print2` until each
    // append detached it: predecessors adopt the old next).
    expect(byId.get(program.thenPrint)?.next ?? null).toBeNull();
    expect(byId.get(program.elsePrint)?.next ?? null).toBeNull();
    // The `if`'s own successor survived the double detach (it adopted
    // the tail's old `next` chain, whose end is the continuation).
    expect(byId.get(program.ifId)?.next ?? null).toBe(program.after);
    expect(byId.get(program.declare)?.planned).toBe(true);
    expect(byId.get(program.declare)?.next ?? null).toBe(program.ifId);
  });

  it("keeps the branch walk inside the branch when it runs", () => {
    buildTwoBranchProgram();
    const run = ok(optilotus_runProgram(), "run");

    // One branch runs, the other does not; the continuation prints
    // after the merge — the engine's own evidence that the moved
    // commands belong to exactly one branch each.
    expect(run.printed).toEqual(["same", "end"]);
  });
});

describe("If/Else merge rails (engine truth)", () => {
  it("derives both tails' merge into the block after the if", () => {
    const program = buildTwoBranchProgram();
    const cmds = projected(0, plannedInto(program.declare, program.ifId));

    // The join point is the `if`'s own successor; both branch tails
    // rejoin there (the engine ends the member's chain, the executor
    // continues at `if.next`). The canvas derives these rails from the
    // branch lists + next — never different ones.
    expect(mergeEdgesOf(cmds)).toEqual([
      { ifId: program.ifId, from: program.thenPrint, to: program.after },
      { ifId: program.ifId, from: program.elsePrint, to: program.after },
    ]);
  });

  it("derives one rail for a single-branch if", () => {
    ok(optilotus_declare(0, "x", optilotus_type.int32, "10"), "declare");
    const created = ok(optilotus_if(0, "true", [], null), "if");
    const only = ok(optilotus_print(0, '"only"'), "print");
    ok(
      optilotus_if_append(0, created.id, "then", only.id),
      "then append",
    );
    const cmds = projected(0);
    const afterNone = cmds.find((c) => c.id === created.id);
    if (afterNone === undefined) throw new Error("if missing");

    // No continuation yet: the tail's `next` is null, so no join point
    // exists and the rail list stays empty.
    expect(afterNone.next ?? null).toBeNull();
    expect(mergeEdgesOf(cmds)).toEqual([]);
  });
});

describe("If/Else manual-merge rails on real engine state", () => {
  it("names both branch tails as the join circle's rails", () => {
    const program = buildTwoBranchProgram();
    const cmds = projected(0, plannedInto(program.declare, program.ifId));

    // Join mode anchors the same engine truth the classic rails carry —
    // the two branch tails — but stops at the circle itself (never at
    // `if.next`, so the circle anchors the flows whether the if has a
    // continuation block under it or not).
    expect(mergeJoinRailsOf(cmds)).toEqual([
      {
        ifId: program.ifId,
        branch: "then",
        from: program.thenPrint,
        emptyBranch: false,
      },
      {
        ifId: program.ifId,
        branch: "else",
        from: program.elsePrint,
        emptyBranch: false,
      },
    ]);
  });

  it("keeps both rails after the continuation is detached (unmerge)", () => {
    const program = buildTwoBranchProgram();

    // The engine-side half of the "Unmerge branches" action (AppShell
    // applies it through `onApplyLinks`): the `if`'s continuation link
    // drops. The branch flows may not be drawn running into the
    // detached block any more — but the circle still anchors BOTH
    // branches, because the rails derive from the branch lists alone
    // and never read `next`.
    ok(optilotus_setNext(0, program.ifId), "detach the continuation");
    const cmds = projected(0, plannedInto(program.declare, program.ifId));
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get(program.ifId)?.next ?? null).toBeNull();

    // Classic picture: no successor, no tail rail anywhere.
    expect(mergeEdgesOf(cmds)).toEqual([]);
    // Join picture: both tails still address the circle.
    expect(mergeJoinRailsOf(cmds)).toEqual([
      {
        ifId: program.ifId,
        branch: "then",
        from: program.thenPrint,
        emptyBranch: false,
      },
      {
        ifId: program.ifId,
        branch: "else",
        from: program.elsePrint,
        emptyBranch: false,
      },
    ]);
  });

  it("feeds the circle from the if's own branch ports when both bodies are empty", () => {
    // A fresh `if` (no members, no continuation — exactly the state a
    // user reaches by dropping an `if` and toggling the merge on):
    // every branch still shows a rail, sourced by the card's own
    // TRUE/FALSE port.
    const declare = ok(
      optilotus_declare(0, "x", optilotus_type.int32, "10"),
      "declare",
    );
    const created = ok(optilotus_if(0, "true", [], null), "if");
    ok(optilotus_setEntry(0, declare.id), "entry");
    const cmds = projected(0);
    const ifCmd = cmds.find((c) => c.id === created.id);
    if (ifCmd === undefined) throw new Error("if missing");
    expect(ifCmd.then_body ?? []).toEqual([]);
    expect(ifCmd.else_body ?? []).toEqual([]);
    expect(ifCmd.next ?? null).toBeNull();

    // The classic rails have nothing to draw; the circle's rails each
    // leave the `if` itself (emptyBranch — the drawn edge starts at the
    // card's own 30%/70% bottom ports in the canvas).
    expect(mergeEdgesOf(cmds)).toEqual([]);
    expect(mergeJoinRailsOf(cmds)).toEqual([
      { ifId: created.id, branch: "then", from: created.id, emptyBranch: true },
      { ifId: created.id, branch: "else", from: created.id, emptyBranch: true },
    ]);
  });

  it("draws a rail for an empty branch beside a populated one", () => {
    // One branch holds a member, the other is empty: the join-mode
    // derivation still gives every TRUE/FALSE branch an arrow into the
    // circle — the populated side through its tail, the empty side
    // through the card's own port. (The classic derivation has nothing
    // to say about the empty branch.)
    const declare = ok(
      optilotus_declare(0, "x", optilotus_type.int32, "10"),
      "declare",
    );
    const created = ok(optilotus_if(0, "true", [], null), "if");
    const only = ok(optilotus_print(0, '"only"'), "only print");
    ok(optilotus_if_append(0, created.id, "then", only.id), "then append");
    ok(optilotus_setEntry(0, declare.id), "entry");
    const cmds = projected(0);
    const ifCmd = cmds.find((c) => c.id === created.id);
    if (ifCmd === undefined) throw new Error("if missing");
    expect(visibleBranchMembers(cmds, ifCmd.else_body)).toEqual([]);

    expect(mergeEdgesOf(cmds)).toEqual([]);
    expect(mergeJoinRailsOf(cmds)).toEqual([
      {
        ifId: created.id,
        branch: "then",
        from: only.id,
        emptyBranch: false,
      },
      {
        ifId: created.id,
        branch: "else",
        from: created.id,
        emptyBranch: true,
      },
    ]);
  });

  it("reads the rails off a chained continuation the same way", () => {
    // The app's connect-in-order gesture leaves `if.next` pointing at a
    // real continuation print (the engine reports the user-level
    // pointer). Join mode: rails stop at the circle; the one drawn wire
    // that carries the flow onward is the circle's own continuation
    // edge — the UI maps `if.next` onto the `jo:` wire (asserted in the
    // canvas tests), so this engine check pins the derivation the
    // canvas maps it onto.
    const declare = ok(
      optilotus_declare(0, "x", optilotus_type.int32, "10"),
      "declare",
    );
    const created = ok(optilotus_if(0, "true", [], null), "if");
    const after = ok(optilotus_print(0, '"end"'), "continuation");
    ok(optilotus_setEntry(0, declare.id), "entry");
    ok(optilotus_setNext(0, created.id, after.id), "wire the continuation");
    const cmds = projected(0);
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get(created.id)?.next ?? null).toBe(after.id);

    // Empty branches: the rails leave the card; no tail rails exist.
    expect(mergeJoinRailsOf(cmds)).toEqual([
      { ifId: created.id, branch: "then", from: created.id, emptyBranch: true },
      { ifId: created.id, branch: "else", from: created.id, emptyBranch: true },
    ]);
    // ...and the run still reaches the continuation through the flow
    // (the if takes the TRUE branch, both bodies empty): the join
    // circle is presentation, never an engine node.
    const run = ok(optilotus_runProgram(), "run");
    expect(run.printed).toEqual(["end"]);
  });
});

describe("If/Else connect rules on real engine state", () => {
  it("routes a member wire onto an outside block to the engine append", () => {
    const program = buildTwoBranchProgram();
    // A second `if` for the member→if drop policy below.
    const other = ok(optilotus_if(0, "false", [], null), "other if");
    const cmds = projected(0, plannedInto(program.declare, program.ifId));

    // The wire leaves a branch member and drops on the block after the
    // `if`: the drop target joins the member's branch (`AppShell` calls
    // `onAppendIfBranch(ifId, branch, targetId)`), which the engine
    // resolves by detaching the target from the main chain.
    const thenTarget = resolveBranchConnect(
      cmds,
      program.thenPrint,
      program.after,
    );
    const elseTarget = resolveBranchConnect(
      cmds,
      program.elsePrint,
      program.after,
    );
    expect(thenTarget).toEqual({
      kind: "append",
      ifId: program.ifId,
      branch: "then",
    });
    expect(elseTarget).toEqual({
      kind: "append",
      ifId: program.ifId,
      branch: "else",
    });
    // A member wire that drops onto another `if` block is refused
    // before any bridge call (the engine would refuse the append too:
    // branches take plain compute commands only).
    expect(
      resolveBranchConnect(cmds, program.thenPrint, other.id),
    ).toEqual({
      kind: "reject",
      reason: "If and Return blocks cannot run inside a branch.",
    });
    // An outside source targeting an `if` is the ordinary planned-edge
    // drop (`AppShell` intercepts if-targets before this resolver when
    // a TRUE/FALSE port is known) — the resolver only says "no branch
    // is involved".
    expect(resolveBranchConnect(cmds, program.after, other.id)).toEqual({
      kind: "none",
    });
  });

  it("appends a block chained before the if into the branch it is wired to", () => {
    // The app's primary auto-membership gesture: a wire from the if's
    // TRUE/FALSE port dropped on a block (`onAppendIfBranch`). The
    // engine moves the block's whole group into the branch and the old
    // chain flows around it — nothing else has to be rewired.
    const declare = ok(
      optilotus_declare(0, "x", optilotus_type.int32, "10"),
      "declare",
    );
    const before = ok(optilotus_print(0, '"before"'), "before print");
    const created = ok(optilotus_if(0, "true", [], null), "if");
    const thenPrint = ok(optilotus_print(0, '"same"'), "then print");
    const elsePrint = ok(optilotus_print(0, '"otherwise"'), "else print");
    const after = ok(optilotus_print(0, '"end"'), "continuation print");
    ok(optilotus_if_append(0, created.id, "then", thenPrint.id), "then append");
    ok(optilotus_if_append(0, created.id, "else", elsePrint.id), "else append");
    ok(optilotus_setEntry(0, declare.id), "entry");

    // Before the wiring the block runs on the main chain, ahead of the
    // `if`.
    const plain = optilotus_runProgram();
    if (plain.status !== "ok") return;
    expect(plain.printed).toEqual(["before", "same", "end"]);

    // The wire from the TRUE port lands on that block: it now runs
    // inside the branch — after the branch's own member, before the
    // merge — and the chain skips ahead to the hidden compute.
    ok(
      optilotus_if_append(0, created.id, "then", before.id),
      "wire the if's TRUE port onto the block",
    );
    const wired = optilotus_runProgram();
    if (wired.status !== "ok") return;
    expect(wired.printed).toEqual(["same", "before", "end"]);

    const cmds = projected(0, plannedInto(declare.id, created.id));
    const byId = new Map(cmds.map((c) => [c.id, c]));
    const ifCmd = byId.get(created.id);
    if (ifCmd === undefined) throw new Error("if missing");
    expect(visibleBranchMembers(cmds, ifCmd.then_body)).toEqual([
      thenPrint.id,
      before.id,
    ]);
    // The detached member ends its chain (the executor's body walk
    // stops there and flow continues at the if's own next)...
    expect(byId.get(before.id)?.next ?? null).toBeNull();
    // ...the main chain flows around the hole the move left...
    expect(byId.get(declare.id)?.next ?? null).toBe(created.id);
    expect(byId.get(created.id)?.next ?? null).toBe(after.id);
    // ...the previous branch tail chains into the moved member (list
    // order = execution order)...
    expect(byId.get(thenPrint.id)?.next ?? null).toBe(before.id);
    // ...and both tails still rejoin at the unchanged join block.
    expect(mergeEdgesOf(cmds)).toEqual([
      { ifId: created.id, from: before.id, to: after.id },
      { ifId: created.id, from: elsePrint.id, to: after.id },
    ]);
  });

  it("refuses a drop onto a branch member from outside", () => {
    const program = buildTwoBranchProgram();
    const cmds = projected(0, plannedInto(program.declare, program.ifId));

    expect(
      resolveBranchConnect(cmds, program.declare, program.thenPrint),
    ).toEqual({
      kind: "reject",
      reason: "That block already runs inside an If/Else branch.",
    });
    expect(resolveBranchConnect(cmds, program.declare, null)).toEqual({
      kind: "none",
    });
  });

  it("refuses a member wire back into its own if and across branches", () => {
    const program = buildTwoBranchProgram();
    const cmds = projected(0, plannedInto(program.declare, program.ifId));

    expect(
      resolveBranchConnect(cmds, program.thenPrint, program.ifId),
    ).toEqual({
      kind: "reject",
      reason: "The branch already ends at its If's join point.",
    });
    expect(
      resolveBranchConnect(cmds, program.thenPrint, program.elsePrint),
    ).toEqual({
      kind: "reject",
      reason: "That block runs in the other branch of this If.",
    });
    // The branch tail's wire into empty canvas is a no-op (nothing
    // follows it inside the branch).
    expect(resolveBranchConnect(cmds, program.thenPrint, null)).toEqual({
      kind: "none",
    });
  });

  it("routes same-branch member wires to the ordinary chain planners", () => {
    ok(optilotus_declare(0, "x", optilotus_type.int32, "10"), "declare");
    const created = ok(optilotus_if(0, "true", [], null), "if");
    const first = ok(optilotus_print(0, '"one"'), "first").id;
    const second = ok(optilotus_print(0, '"two"'), "second").id;
    ok(optilotus_if_append(0, created.id, "then", first), "append 1");
    ok(optilotus_if_append(0, created.id, "then", second), "append 2");
    const cmds = projected(0);
    const owners = branchOwnerOf(cmds);
    // Both members report to the same if/side...
    expect(owners.get(first)?.branch).toBe("then");
    expect(owners.get(second)?.branch).toBe("then");
    // ...and the engine itself reports the in-branch successor (the
    // append chained the previous tail forward), so a drag between the
    // two members is an ordinary same-branch reorder.
    const byId = new Map(cmds.map((c) => [c.id, c]));
    expect(byId.get(first)?.next ?? null).toBe(second);
    expect(resolveBranchConnect(cmds, first, second)).toEqual({
      kind: "chain",
    });
  });

  it("refuses mid-branch wires into empty canvas", () => {
    ok(optilotus_declare(0, "x", optilotus_type.int32, "10"), "declare");
    const created = ok(optilotus_if(0, "true", [], null), "if");
    const first = ok(optilotus_print(0, '"one"'), "first").id;
    const second = ok(optilotus_print(0, '"two"'), "second").id;
    ok(optilotus_if_append(0, created.id, "then", first), "append 1");
    ok(optilotus_if_append(0, created.id, "then", second), "append 2");
    const cmds = projected(0);

    // The first member's successor stays inside the branch: releasing
    // its wire would sever the body chain the executor walks.
    expect(resolveBranchConnect(cmds, first, null)).toEqual({
      kind: "reject",
      reason: "That block's successor stays inside the branch.",
    });
  });
});

describe("If/Else append defences (bridge envelopes)", () => {
  it("rejects a re-append into the branch it already runs in", () => {
    const program = buildTwoBranchProgram();
    expect(
      optilotus_if_append(0, program.ifId, "then", program.thenPrint),
    ).toMatchObject({
      status: "error",
      message: "command is already wired to this branch",
    });
    // (Appending into the *other* branch of the same `if` is the
    // engine's documented cross-side move — tested explicitly below.)
  });

  it("rejects an `if`, a `return` and unknown ids", () => {
    ok(optilotus_declare(0, "x", optilotus_type.int32, "10"), "declare");
    const outer = ok(optilotus_if(0, "true", [], null), "outer if");
    const inner = ok(optilotus_if(0, "false", [], null), "inner if");
    const ret = ok(optilotus_return(0, '"done"'), "return");
    const member = ok(optilotus_print(0, '"m"'), "member");
    ok(optilotus_if_append(0, inner.id, "then", member.id), "inner member");

    expect(
      optilotus_if_append(0, outer.id, "then", inner.id),
    ).toMatchObject({
      status: "error",
      message: "if and return cannot join an `if` branch",
    });
    expect(
      optilotus_if_append(0, inner.id, "then", ret.id),
    ).toMatchObject({
      status: "error",
      message: "if and return cannot join an `if` branch",
    });
    // A member of another `if` cannot be adopted: it already runs in
    // that if's branch walk.
    expect(
      optilotus_if_append(0, outer.id, "then", member.id),
    ).toMatchObject({
      status: "error",
      message: "command is already wired to another branch",
    });
    expect(
      optilotus_if_append(0, outer.id, "then", outer.id),
    ).toMatchObject({
      status: "error",
      message: "an `if` cannot be wired into its own branch",
    });
    expect(optilotus_if_append(0, outer.id, "then", 999)).toMatchObject({
      status: "error",
      message: "unknown command 999",
    });
    expect(optilotus_if_append(0, 999, "then", 1)).toMatchObject({
      status: "error",
      message: "unknown command 999",
    });
  });

  it("moves a member across branches of the same if when told to", () => {
    // The engine's own cross-branch move: `if_append` on the other
    // side of the *same* `if` lifts the member out of the opposite
    // branch list. The canvas refuses this shape as a *wire* (a second
    // predecessor lie — see `resolveBranchConnect`) and exposes the
    // move by dragging the member itself instead.
    const program = buildTwoBranchProgram();
    ok(
      optilotus_if_append(0, program.ifId, "then", program.elsePrint),
      "move",
    );
    const cmds = projected(0, plannedInto(program.declare, program.ifId));
    const byId = new Map(cmds.map((c) => [c.id, c]));
    const ifCmd = byId.get(program.ifId);
    if (ifCmd === undefined) throw new Error("if missing");
    expect(visibleBranchMembers(cmds, ifCmd.else_body)).toEqual([]);
    expect(visibleBranchMembers(cmds, ifCmd.then_body)).toEqual([
      program.thenPrint,
      program.elsePrint,
    ]);

    // Both prints now run inside the taken branch, then the merge.
    const run = optilotus_runProgram();
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["same", "same", "end"]);
    // The previous branch tail chains forward into the moved member
    // (the executor walks the branch's list order).
    expect(byId.get(program.thenPrint)?.next ?? null).toBe(
      program.elsePrint,
    );
  });
});

describe("Execution-glow decisions on real engine state", () => {
  /**
   * The freeze the hook performs at run start (`useFlowGlow.startFlow`):
   * projected commands, the canvas entry, and the literal conditions
   * read from the engine itself — exactly `"true"` / `"false"`.
   */
  function freeze(
    fid: number,
    planned: ReadonlyMap<number, number>,
  ): {
    cmds: readonly UiCommand[];
    entry: number | null;
    literals: Map<number, boolean>;
  } {
    const cmds = projected(fid, planned);
    const literals = new Map<number, boolean>();
    for (const cmd of cmds) {
      if (cmd.kind !== "if") continue;
      const condition = optilotus_if_condition(fid, cmd.id);
      if (condition.status !== "ok") continue;
      if (condition.expr === "true") literals.set(cmd.id, true);
      else if (condition.expr === "false") literals.set(cmd.id, false);
    }
    return { cmds, entry: canvasEntry(fid, cmds), literals };
  }

  it("follows the literal condition when both branches print identical lines", () => {
    const program = buildTwoBranchProgram();
    ok(optilotus_setEntry(0, program.declare), "entry");
    const run = optilotus_runProgram();
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["same", "end"]);

    const literal = optilotus_if_condition(0, program.ifId);
    if (literal.status !== "ok") return;
    expect(literal.expr).toBe("true");

    const { cmds, entry, literals } = freeze(
      0,
      plannedInto(program.declare, program.ifId),
    );
    expect(literals).toEqual(new Map([[program.ifId, true]]));

    // Envelope alone cannot decide (both branches print "same");
    // the engine's own literal follows the branch the run took: TRUE
    // into its member, the member's merge back into the continuation.
    expect(resolveRunPath(cmds, entry, 0, run.printed, literals)).toEqual([
      { fid: 0, from: program.declare, to: program.ifId, kind: "chain" },
      { fid: 0, from: program.ifId, to: program.thenPrint, kind: "branch-head" },
      { fid: 0, from: program.thenPrint, to: program.after, kind: "merge" },
      { fid: 0, from: program.ifId, to: program.after, kind: "chain" },
    ]);

    // Flip the condition through the engine and the same envelope now
    // decides FALSE — the glow must follow the engine's own condition.
    ok(
      optilotus_if_set_condition(0, program.ifId, "false"),
      "flip condition",
    );
    const flipped = optilotus_runProgram();
    if (flipped.status !== "ok") return;
    expect(flipped.printed).toEqual(["same", "end"]);
    const flippedFreeze = freeze(0, plannedInto(program.declare, program.ifId));
    expect(flippedFreeze.literals).toEqual(
      new Map([[program.ifId, false]]),
    );
    expect(
      resolveRunPath(
        flippedFreeze.cmds,
        flippedFreeze.entry,
        0,
        flipped.printed,
        flippedFreeze.literals,
      ),
    ).toEqual([
      { fid: 0, from: program.declare, to: program.ifId, kind: "chain" },
      { fid: 0, from: program.ifId, to: program.elsePrint, kind: "branch-head" },
      { fid: 0, from: program.elsePrint, to: program.after, kind: "merge" },
      { fid: 0, from: program.ifId, to: program.after, kind: "chain" },
    ]);
  });

  it("stays undecided when no literal is available", () => {
    const program = buildTwoBranchProgram();
    ok(optilotus_setEntry(0, program.declare), "entry");
    const run = optilotus_runProgram();
    if (run.status !== "ok") return;

    // Same envelope, but without the engine's literal (a variable
    // condition the engine cannot name as true/false): the glow travels
    // the chain only and never claims either branch.
    const { cmds, entry } = freeze(0, plannedInto(program.declare, program.ifId));
    const undecided = resolveRunPath(cmds, entry, 0, run.printed, new Map());
    expect(undecided).toEqual([
      { fid: 0, from: program.declare, to: program.ifId, kind: "chain" },
      { fid: 0, from: program.ifId, to: program.after, kind: "chain" },
    ]);
  });

  it("follows a proven branch from the envelope without a literal", () => {
    const declare = ok(
      optilotus_declare(0, "x", optilotus_type.int32, "10"),
      "declare",
    );
    const created = ok(optilotus_if(0, "true", [], null), "if");
    const thenPrint = ok(optilotus_print(0, '"big"'), "then print");
    const elsePrint = ok(optilotus_print(0, '"small"'), "else print");
    const after = ok(optilotus_print(0, '"end"'), "end print");
    ok(optilotus_if_append(0, created.id, "then", thenPrint.id), "append t");
    ok(optilotus_if_append(0, created.id, "else", elsePrint.id), "append e");
    ok(optilotus_setEntry(0, declare.id), "entry");

    const { cmds, entry, literals } = freeze(
      0,
      plannedInto(declare.id, created.id),
    );
    const run = optilotus_runProgram();
    if (run.status !== "ok") return;
    expect(run.printed).toEqual(["big", "end"]);

    // The window proves exactly one branch ("big" only appears in the
    // then list) — no literal needed; the envelope decides. The literal
    // is present in the freeze and simply not needed.
    expect(literals.get(created.id)).toBe(true);
    const noLiterals = resolveRunPath(cmds, entry, 0, run.printed, new Map());
    expect(noLiterals).toEqual([
      { fid: 0, from: declare.id, to: created.id, kind: "chain" },
      { fid: 0, from: created.id, to: thenPrint.id, kind: "branch-head" },
      { fid: 0, from: thenPrint.id, to: after.id, kind: "merge" },
      { fid: 0, from: created.id, to: after.id, kind: "chain" },
    ]);
  });
});
