import {
  optilotus_type,
  type CommandSummary,
  type OptilotusType,
} from "./optilotus";

/**
 * Casting is an option of an Assign Variable block, not a block of its
 * own. The Engine's `Set` operation only stores a value whose type
 * equals the destination variable's declared type, and a variable's
 * runtime type can never change — so the destination's declaration is
 * the boundary casting must respect. Two shapes cover every target:
 *
 * **Target equals the destination's declared type** — the value the
 * assignment stores already has the right type, and a hidden single-leg
 * group produces it through the public bridge:
 *
 *     declare anchor          (hidden, entry/link handle)
 *     cast temp = <source>    (hidden; the user's chosen conversion)
 *     assign dest = {temp}    (the visible Assign Variable block)
 *
 * The user's chosen conversion runs the Engine's real
 * `ops::cast_value`; a value it cannot produce (`"abc"` → `int32`)
 * fails at run time with the Engine's own error.
 *
 * **Target differs from the destination's declared type** — the value
 * the user asked for simply cannot live in the destination variable, so
 * the apply replaces the assignment with the Engine's *native* cast
 * command, which both converts and **creates** a fresh variable:
 *
 *     declare anchor          (hidden; name carries the out variable)
 *     cast <outName> to <target> = <source>   (real, visible Cast block)
 *
 * `cast` requires its variable to be undeclared, and its self-contained
 * group (compute → cast → `Set` with the target type) stores the
 * converted value in `outName`. The destination's declare block, its
 * position and its initial value are never rewritten; the converted
 * value is read through the new variable (e.g. `int32 x 5` cast to
 * `float64` prints `{x}` as `5` and `{x_f64}` as `5.0`). The derived
 * name comes from the assignment's destination and the target tag
 * (`x_float64` → `x_f64`), suffixed when taken, and the created cast
 * block is a normal block the user can edit, rename or delete.
 *
 * The hidden anchor keeps the same role in both shapes: it is a
 * `declare` whose user id is the group's head, so `set_entry` and
 * `set_next` can address the start of the whole group.
 */

/** Reserved prefix shared by every internally generated command name. */
export const CAST_INTERNAL_PREFIX = "__aqualotus_internal_";
const CAST_ANCHOR_PREFIX = `${CAST_INTERNAL_PREFIX}anchor_`;
const CAST_TEMP_PREFIX = `${CAST_INTERNAL_PREFIX}cast_`;

/** A UI-side casting choice on an Assign Variable block. */
export interface CastingSetting {
  readonly enabled: boolean;
  /**
   * Conversion target. `null` is the deliberate "Casting is on, but no
   * target has been chosen" state — never an arbitrary default.
   */
  readonly targetType: OptilotusType | null;
}

/** Alias used by the editable command model. */
export type CastingDraft = CastingSetting;

/** Casting is off for a fresh ordinary assignment. */
export const CASTING_DISABLED: CastingSetting = {
  enabled: false,
  targetType: null,
};

/**
 * The hidden Engine commands behind one visible casting block.
 *
 * `anchorId` is a user-level Engine command id whose summary exists in
 * `list_commands`, but the UI never shows it. `castId` names the
 * user's chosen conversion; for the single-leg shape it is a hidden
 * temp cast (the visible block is an assign), for the native shape it
 * is the visible block itself (a Cast block with the derived name).
 */
export interface CastingInfo {
  readonly anchorId: number;
  /** The user's chosen conversion: source expression into `targetType`. */
  readonly castId: number;
  /**
   * The variable holding the value in `targetType`: the generated
   * hidden temp (single leg) or the derived published name (native
   * cast shape).
   */
  readonly tempName: string;
  /**
   * The assignment's destination name the converted variable's name was
   * derived from. Recovered from the generated name for the native
   * shape (the visible block is the cast, so the destination name is
   * not otherwise readable), and simply the assignment's own variable
   * for the single-leg shape. It lets the UI rebuild the same group
   * after an undo or an edit, so a restored block never loses its
   * hidden head.
   */
  readonly destinationName: string;
  readonly sourceExpr: string;
  readonly targetType: OptilotusType;
}

/** One complete hidden conversion group (verified by the projector). */
export interface CastingPair {
  readonly anchorId: number;
  readonly castId: number;
  /**
   * The visible assign the group collapses into; `undefined` for the
   * native-cast shape, whose visible representative IS the cast block.
   */
  readonly assignId?: number;
  readonly tempName: string;
  /** See {@link CastingInfo.destinationName}. */
  readonly destinationName: string;
  readonly sourceExpr: string;
  readonly targetType: OptilotusType;
}

/** Result of collapsing hidden conversion groups out of a command list. */
export interface CastingCollapse<T extends CommandSummary> {
  /** User-visible commands. Casting blocks carry their conversion info. */
  readonly commands: (T & { casting?: CastingInfo })[];
  /** Hidden command id → the visible id that owns it. */
  readonly redirects: ReadonlyMap<number, number>;
  /** Visible block id → its hidden conversion group. */
  readonly castings: ReadonlyMap<number, CastingInfo>;
  readonly pairs: readonly CastingPair[];
}

/**
 * Target types the Engine's conversion primitive (`ops::cast_value`)
 * can produce. Derived from the generated `Type` union minus `void`,
 * which `cast_value` always rejects, so the menu cannot drift from the
 * Engine's own type table.
 *
 * This is a *target-type* capability list, not a claim that every
 * source→target pair succeeds: the Engine validates the actual value at
 * run time (for example `"abc"` → `int32` fails).
 */
export const CAST_TARGET_TYPES: readonly OptilotusType[] = (
  Object.values(optilotus_type) as OptilotusType[]
).filter((t) => t !== optilotus_type.void);

/**
 * Compact suffix per type tag, used to derive the converted variable's
 * name (`x` cast to `float64` → `x_f64`). Keys are checked against the
 * generated type union, so a missing tag is a compile error.
 */
const CAST_TYPE_SUFFIX = {
  int8: "i8",
  int16: "i16",
  int32: "i32",
  int64: "i64",
  int128: "i128",
  uint8: "u8",
  uint16: "u16",
  uint32: "u32",
  uint64: "u64",
  uint128: "u128",
  float32: "f32",
  float64: "f64",
  bool: "bool",
  char: "char",
  string: "str",
} as const satisfies Record<Exclude<OptilotusType, typeof optilotus_type.void>, string>;

/** True while Casting is on but the user has not chosen a target type. */
export function castingIncomplete(
  setting: CastingSetting | null | undefined,
): boolean {
  return setting?.enabled === true && setting.targetType === null;
}

/** The compact tag suffix used to derive a converted variable's name. */
function castTypeSuffix(targetType: OptilotusType): string {
  if (targetType === optilotus_type.void) return "void";
  return CAST_TYPE_SUFFIX[targetType];
}

/**
 * The name the native cast block would give the converted variable:
 * the assignment's destination followed by the target's compact tag,
 * disambiguated with a numeric suffix when the name (or its exact
 * anchor handle) is taken. `taken` must include every variable name
 * alive in the function, including the reserved ones.
 */
export function convertedVariableName(
  taken: Iterable<string>,
  destinationName: string,
  targetType: OptilotusType,
): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name.trim());
  const base = destinationName.trim() || "value";
  const suffix = castTypeSuffix(targetType);
  let candidate = `${base}_${suffix}`;
  let k = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}_${k}`;
    k += 1;
  }
  return candidate;
}

/**
 * The fresh names one native-cast conversion group needs: the derived
 * published variable name and the matching reserved anchor handle.
 * Both must be free, so the loop advances the numeric disambiguator
 * until the pair is untaken.
 */
export function nextConvertedNames(
  taken: Iterable<string>,
  destinationName: string,
  targetType: OptilotusType,
): { anchorName: string; outName: string } {
  const used = new Set<string>();
  for (const name of taken) used.add(name.trim());
  const base = destinationName.trim() || "value";
  const suffix = castTypeSuffix(targetType);
  let k = 1;
  for (;;) {
    const outName =
      k === 1 ? `${base}_${suffix}` : `${base}_${suffix}_${k}`;
    const anchorName = `${CAST_ANCHOR_PREFIX}${outName}`;
    if (!used.has(outName) && !used.has(anchorName)) {
      return { anchorName, outName };
    }
    k += 1;
  }
}

/**
 * The destination name a converted variable's generated name came from
 * — the exact inverse of {@link convertedVariableName} /
 * {@link nextConvertedNames}: `x_f64` cast to `float64` came from `x`,
 * and `x_f64_2` (a disambiguated name) also came from `x`.
 *
 * `null` when the name does not carry the target's suffix, so an
 * arbitrary cast row is never claimed as a UI conversion group.
 */
export function destinationNameOf(
  convertedName: string,
  targetType: OptilotusType,
): string | null {
  const suffix = `_${castTypeSuffix(targetType)}`;
  let base = convertedName.trim();
  if (!base.endsWith(suffix)) {
    // A disambiguated name holds the tag *before* the numeric suffix
    // (`x_f64_2`); a plain name never reaches this branch.
    const disambiguator = /_\d+$/.exec(base);
    if (disambiguator === null) return null;
    base = base.slice(0, -disambiguator[0].length);
    if (!base.endsWith(suffix)) return null;
  }
  return base.slice(0, -suffix.length);
}

/**
 * Human explanation of what applying the chosen conversion does when
 * the target differs from the destination's declared type (or the
 * destination is not declared at all): the block becomes a real Engine
 * cast that creates the converted value in a new variable of the
 * target type, and the original variable is never rewritten. `null`
 * when the target already matches the destination's type (an ordinary
 * hidden conversion group, which stores into the destination) or while
 * Casting is off / has no target.
 */
export function castConvertedVariableNote(
  setting: CastingSetting | null | undefined,
  destinationType: OptilotusType | undefined,
  destinationName?: string,
): string | null {
  if (
    setting?.enabled !== true ||
    setting.targetType === null ||
    (destinationType !== undefined &&
      setting.targetType === destinationType)
  ) {
    return null;
  }
  const preview = convertedVariableName(
    [],
    destinationName ?? "",
    setting.targetType,
  );
  if (destinationType === undefined) {
    return `The destination is not declared. Applying replaces this assignment with a real Engine cast that creates the converted value in a new ${setting.targetType} variable (about ${preview}; a numeric suffix is added if the name is taken). Read the converted value through that variable.`;
  }
  return `The destination keeps its declared type ${destinationType} and its value. Applying replaces this assignment with a real Engine cast that creates the converted value in a new ${setting.targetType} variable (about ${preview}; a numeric suffix is added if the name is taken). Read the converted value through that variable.`;
}

/**
 * True only for a projected assign or cast block whose conversion group
 * is complete: a legal target type and a resolvable command.
 *
 * The native-cast shape guarantees a storable target by construction
 * (the cast creates its own variable), so any legal target is a valid
 * configuration and the canvas annotates every one of them.
 */
export function castingIndicatorVisible(command: {
  readonly kind?: string;
  readonly ty?: CommandSummary["ty"];
  readonly casting?: CastingInfo;
}): boolean {
  const casting = command.casting;
  if (casting === undefined) return false;
  if (command.kind !== "assign" && command.kind !== "cast") return false;
  if (command.ty === undefined) return false;
  if (!CAST_TARGET_TYPES.includes(casting.targetType)) return false;
  return true;
}

/** An internally generated anchor/temp name (never user-authored). */
export function isInternalCastingName(name: string | undefined): boolean {
  return name !== undefined && name.startsWith(CAST_INTERNAL_PREFIX);
}

/**
 * Fresh reserved names for one hidden single-leg conversion group.
 * `taken` must include every variable name already declared in the
 * function (including the hidden names of existing groups), so a group
 * can never collide: the pair is the anchor and the conversion temp.
 */
export function nextCastingNames(taken: Iterable<string>): {
  anchorName: string;
  tempName: string;
} {
  const used = new Set<string>();
  for (const name of taken) used.add(name.trim());
  let n = 1;
  for (;;) {
    const anchorName = `${CAST_ANCHOR_PREFIX}${n}`;
    const tempName = `${CAST_TEMP_PREFIX}${n}`;
    if (!used.has(anchorName) && !used.has(tempName)) {
      return { anchorName, tempName };
    }
    n += 1;
  }
}

/**
 * The declared type of a function variable, when the command list
 * reports it. Used to validate a conversion target before any Engine
 * write. Summaries written by the Engine always carry the declared
 * type; an unknown name returns `undefined` and is left to the Engine.
 */
export function declaredTypeOf(
  commands: readonly CommandSummary[],
  name: string,
): CommandSummary["ty"] | undefined {
  const wanted = name.trim();
  if (wanted === "") return undefined;
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const cmd = commands[i];
    if (
      cmd !== undefined &&
      (cmd.kind === "declare" || cmd.kind === "cast") &&
      (cmd.var ?? "").trim() === wanted
    ) {
      return cmd.ty;
    }
  }
  return undefined;
}

/**
 * Remove the hidden groups from an Engine command list.
 *
 * A group is collapsed only when the reserved names and the stores
 * agree, so an arbitrary user program that happens to contain a
 * reserved-looking name is never rewritten. Two shapes are recognised:
 *
 * - **single leg** (target equals the destination's declared type) — a
 *   `declare` anchor with the reserved prefix and the same numeric
 *   suffix as a `cast` with the reserved temp prefix, which points at
 *   an `assign` of the destination whose expression is exactly
 *   `{temp}` and whose declared type equals the cast target;
 * - **native cast** (target differs, or the destination is undeclared)
 *   — a `declare` anchor whose name is `anchor_` + the published
 *   variable name, whose successor is a real `cast` of exactly that
 *   variable with a legal (non-reserved, non-internal) target type.
 *   The cast block itself stays visible and carries the group's info.
 *
 * The engine does **not** report the anchor → cast edge (the anchor's
 * raw successor is the cast's hidden compute command, and
 * `Package::user_next` returns `None` for hidden nodes), so pairing by
 * generated names is the only public way to associate the commands.
 * The pattern is intentionally narrow: anchors must carry the UI's
 * reserved prefix and pair with the block by exact generated name, and
 * for the single-leg shape the destination assignment must store
 * exactly the generated temp.
 *
 * The visible representative keeps its Engine id, so selection, links
 * and history stay stable. Its displayed expression is the conversion
 * source; its hidden links are exposed through {@link CastingInfo}.
 */
export function collapseCasting<T extends CommandSummary>(
  cmds: readonly T[],
): CastingCollapse<T> {
  const byId = new Map<number, T>();
  const declaresByName = new Map<string, T>();
  for (const cmd of cmds) {
    byId.set(cmd.id, cmd);
    if (cmd.kind === "declare") {
      const name = cmd.var?.trim() ?? "";
      if (name !== "") declaresByName.set(name, cmd);
    }
  }

  const pairs: CastingPair[] = [];
  const hidden = new Set<number>();
  const redirected = new Map<number, number>();
  const usedAnchors = new Set<number>();
  const usedAssigns = new Set<number>();

  /** Internal reserved-cast temp name, or `null`. */
  const reservedTemp = (name: string | undefined): string | null => {
    const trimmed = name?.trim() ?? "";
    if (!trimmed.startsWith(CAST_TEMP_PREFIX)) return null;
    const suffix = trimmed.slice(CAST_TEMP_PREFIX.length);
    return /^\d+$/.test(suffix) ? trimmed : null;
  };

  /**
   * The anchor expected for a temp with suffix `s`, when present and
   * not already claimed by another group.
   */
  const anchorFor = (suffixName: string): T | undefined => {
    const idx = suffixName.slice(CAST_TEMP_PREFIX.length);
    const anchor = declaresByName.get(`${CAST_ANCHOR_PREFIX}${idx}`);
    return anchor !== undefined && !hidden.has(anchor.id) && !usedAnchors.has(anchor.id)
      ? anchor
      : undefined;
  };

  // Pass 1 — hidden single-leg groups (assign representative).
  for (const cast of cmds) {
    if (cast.kind !== "cast") continue;
    const tempName = reservedTemp(cast.var);
    if (tempName === null) continue;
    if (hidden.has(cast.id)) continue;
    if (cast.next === null || cast.next === undefined) continue;
    const assign = byId.get(cast.next);
    if (assign === undefined || assign.kind !== "assign") continue;
    if (usedAssigns.has(assign.id)) continue;
    if (cast.ty === undefined || assign.ty === undefined) continue;
    if (assign.ty !== cast.ty) continue;
    if ((assign.expr ?? "").trim() !== `{${tempName}}`) continue;
    const anchor = anchorFor(tempName);
    if (anchor === undefined) continue;
    const pair: CastingPair = {
      anchorId: anchor.id,
      castId: cast.id,
      assignId: assign.id,
      tempName,
      // Single leg: the visible block IS the assignment, so its variable
      // is the destination the group stores into.
      destinationName: (assign.var ?? "").trim(),
      sourceExpr: cast.expr ?? "",
      targetType: cast.ty,
    };
    pairs.push(pair);
    hidden.add(anchor.id);
    hidden.add(cast.id);
    usedAnchors.add(anchor.id);
    usedAssigns.add(assign.id);
    redirected.set(anchor.id, assign.id);
    redirected.set(cast.id, assign.id);
  }

  // Pass 2 — native-cast groups (the visible block IS the cast).
  for (const cast of cmds) {
    if (cast.kind !== "cast") continue;
    // A reserved temp already belongs to a single-leg group; published
    // names never carry the reserved prefixes.
    if (reservedTemp(cast.var) !== null) continue;
    const outName = cast.var?.trim() ?? "";
    if (outName === "" || isInternalCastingName(outName)) continue;
    if (cast.ty === undefined) continue;
    // The converted variable's name is the derived one, so the
    // destination it came from is recoverable — and a row whose name
    // does not carry the target's tag is not a group this UI created.
    const destinationName = destinationNameOf(outName, cast.ty);
    if (destinationName === null) continue;
    const anchor = declaresByName.get(`${CAST_ANCHOR_PREFIX}${outName}`);
    if (anchor === undefined) continue;
    if (hidden.has(anchor.id) || usedAnchors.has(anchor.id)) continue;
    const pair: CastingPair = {
      anchorId: anchor.id,
      castId: cast.id,
      tempName: outName,
      destinationName,
      sourceExpr: cast.expr ?? "",
      targetType: cast.ty,
    };
    pairs.push(pair);
    hidden.add(anchor.id);
    usedAnchors.add(anchor.id);
    redirected.set(anchor.id, cast.id);
  }

  const pairByVisible = new Map<number, CastingPair>();
  for (const pair of pairs) {
    pairByVisible.set(pair.assignId ?? pair.castId, pair);
  }

  const commands = cmds
    .filter((cmd) => !hidden.has(cmd.id))
    .map((cmd): T & { casting?: CastingInfo } => {
      const pair = pairByVisible.get(cmd.id);
      const next =
        cmd.next !== null && cmd.next !== undefined
          ? (redirected.get(cmd.next) ?? cmd.next)
          : (cmd.next ?? null);
      if (pair === undefined) {
        return next === cmd.next ? cmd : { ...cmd, next };
      }
      return {
        ...cmd,
        ...(pair.assignId !== undefined ? { expr: pair.sourceExpr } : {}),
        next,
        casting: {
          anchorId: pair.anchorId,
          castId: pair.castId,
          tempName: pair.tempName,
          destinationName: pair.destinationName,
          sourceExpr: pair.sourceExpr,
          targetType: pair.targetType,
        },
      };
    });

  const castings = new Map<number, CastingInfo>();
  for (const cmd of commands) {
    if (cmd.casting !== undefined) castings.set(cmd.id, cmd.casting);
  }

  return { commands, redirects: redirected, castings, pairs };
}

/**
 * Resolve an Engine entry id against a collapsed list.
 *
 * A conversion group's entry is its anchor `declare` head. That id is a
 * hidden command, so map it to the visible block before the existing
 * `if`-aware resolver runs.
 */
export function resolveCastingEntry(
  renderEntry: (entry: number | null) => number | null,
  redirects: ReadonlyMap<number, number>,
  entry: number | null,
): number | null {
  if (entry === null) return null;
  return renderEntry(redirects.get(entry) ?? entry);
}
