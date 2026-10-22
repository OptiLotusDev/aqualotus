/**
 * Runtime-failure model (UI-owned).
 *
 * The engine reports an execution failure with the id of the **internal
 * IR node** that failed (`ExecError::command`, exposed by the bridge as
 * `ErrorResponse.command`). The canvas knows the ids of the **visible
 * blocks** the user drew. The two live in the same numeric space, but
 * they are not the same set:
 *
 * - a block can own several raw nodes (a `print` owns a hidden `Print`
 *   node behind its literal; a `cast` owns a hidden compute and a
 *   hidden cast node), and the engine blames the node that actually
 *   failed;
 * - the engine also owns hidden nodes that belong to no block at all
 *   (an `if`'s condition compute, the commands inside an `if` branch
 *   body).
 *
 * The UI therefore never treats the reported id as a block id. It
 * resolves it through {@link resolveErrorTarget}, and when the id
 * belongs to a node no visible block owns, the target stays
 * **unresolved**: the failure is shown, but the UI never highlights a
 * block it cannot name.
 */
import type { CommandId, FunctionId, OptilotusError } from "./optilotus";

/**
 * A failure the bridge reported, kept exactly as it arrived.
 *
 * Every field survives the trip into the UI state: the error family
 * (`kind`), the engine's message, the internal IR node id (`command`)
 * and the kind-specific extras (`detail`, `value`, `expected`,
 * `found`, `limit`, `var`, `function`). The envelope is never
 * flattened into a bare string, so the UI can show the original type
 * and the original message side by side.
 */
export type UiRunError = OptilotusError;

/**
 * The internal IR node id the engine blamed.
 *
 * This is **not** a visible block id: it may name a hidden node (see
 * the module header). `null` when the failure is not tied to a node at
 * all (`LoopLimit`, `Paused`, `InvalidState`).
 */
export function internalCommandOf(
  error: UiRunError | null,
): CommandId | null {
  if (error === null) return null;
  return typeof error.command === "number" ? error.command : null;
}

/** A visible block a failure points at, and the function that owns it. */
export interface ErrorTarget {
  /** The visible block that owns the failing node. */
  readonly blockId: CommandId;
  /** The function that owns the block. */
  readonly functionId: FunctionId;
}

/** The part of a command summary the resolution needs. */
export interface IdentifiedCommand {
  readonly id: number;
}

/**
 * Resolve the engine's internal node id to the visible block it owns.
 *
 * Why this is a **verified** lookup and not a guess:
 *
 * - the engine allocates **every** raw node id from one package-wide
 *   counter (`Package::alloc_command_id`), so raw node ids are unique
 *   across the whole package — an id cannot belong to two nodes;
 * - a visible block's id **is** the raw id of the node the block owns
 *   (the engine's `meta` registry is keyed by that node), so the set
 *   of visible block ids is a subset of the raw node ids;
 * - therefore a reported id that is found among the visible block ids
 *   is *the very node the engine blamed* — not a number that merely
 *   looks alike — and the block that owns it is the block that failed.
 *
 * The search spans **all** functions, because a failure inside a called
 * helper is reported with a node id of the helper.
 *
 * An id that is not a visible block id belongs to a hidden node: a
 * `print`'s hidden `Print` node, a `declare`/`assign`'s hidden `Set`
 * node, a `cast`'s hidden compute and cast nodes, an `if`'s hidden
 * condition compute, or a node inside an `if` branch body. The engine
 * exposes no way to name the block that owns such a node, so the
 * target stays unresolved — the UI must not invent one.
 */
export function resolveErrorTarget(
  commandsByFunction: Readonly<
    Record<number, readonly IdentifiedCommand[]>
  >,
  internalId: CommandId | null,
): ErrorTarget | null {
  if (internalId === null) return null;
  for (const key of Object.keys(commandsByFunction)) {
    const fid = Number(key);
    const cmds = commandsByFunction[fid] ?? [];
    if (!cmds.some((c) => c.id === internalId)) continue;
    return { blockId: internalId, functionId: fid };
  }
  return null;
}

/** One structured field of a failure, ready to be displayed. */
export interface ErrorField {
  readonly label: string;
  readonly value: string;
}

/**
 * The kind-specific extras of a failure, as displayable fields.
 *
 * The engine sends them only for the error families that have them:
 * `detail` (the typed failures), `value` (`MissingValue`),
 * `expected`/`found` (`Arity`), `limit` (`LoopLimit`), `var`
 * (`UnknownVariable`) and `function` (`UnknownFunction` /
 * `MissingReturn`). They are shown next to the message so nothing the
 * engine reported is lost on the way to the screen.
 */
export function errorFields(error: UiRunError): readonly ErrorField[] {
  const out: ErrorField[] = [];
  if (error.detail !== undefined && error.detail !== "") {
    out.push({ label: "Detail", value: error.detail });
  }
  if (error.value !== undefined) {
    out.push({ label: "Value", value: String(error.value) });
  }
  if (error.expected !== undefined) {
    out.push({ label: "Expected", value: error.expected });
  }
  if (error.found !== undefined) {
    out.push({ label: "Found", value: String(error.found) });
  }
  if (error.limit !== undefined) {
    out.push({ label: "Limit", value: String(error.limit) });
  }
  if (error.var !== undefined) {
    out.push({ label: "Variable", value: error.var });
  }
  if (error.function !== undefined) {
    out.push({ label: "Function", value: error.function });
  }
  return out;
}
