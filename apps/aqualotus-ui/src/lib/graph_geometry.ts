/**
 * Port geometry: every edge must start at and end on the *centre of a
 * drawn port circle* — never on a block border the port does not sit on
 * — so the drawn geometry and the CSS port offsets are kept in one
 * place (P3/P17, port-centred edges).
 *
 * - `inLeft` / `outRight` — the side ports every ordinary block carries
 *   (chain flow reads left → right);
 * - `inTop` / `outBottom` — the vertical pair a branch body member
 *   carries (a body runs top → bottom);
 * - `then` / `else` — the `if` card's bottom TRUE/FALSE ports (30% /
 *   70% of the card width, mirroring `BRANCH_PORT_FRACTION` in CSS);
 * - `joinIn` / `joinOut` — the manual merge join point (the "End of If
 *   Block" circle): tails enter its top, the continuation leaves its
 *   right.
 */

export interface BlockRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type BlockSide = "top" | "bottom" | "left" | "right" | "then" | "else";

export interface EdgeEnds {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly horizontal: boolean;
}

export type PortRole =
  | "inLeft"
  | "inTop"
  | "outRight"
  | "outBottom"
  | "then"
  | "else"
  | "joinIn"
  | "joinOut";

export interface PortPoint {
  readonly x: number;
  readonly y: number;
  /** `true` when the edge on this side reads horizontally. */
  readonly horizontal: boolean;
}

/** The fraction of an `if` card's width where each branch port sits, on
 * the card's **bottom** edge: TRUE at 30%, FALSE at 70% of the width —
 * branching downward into the vertical TRUE/FALSE body containers.
 * Kept in one place because the canvas CSS mirrors the same fractions
 * (`.vport-then.vport-bottom { left: 30% }`) and both must move
 * together when the card's layout changes. */
export const BRANCH_PORT_FRACTION: Record<"then" | "else", number> = {
  then: 0.3,
  else: 0.7,
} as const;

/** A port-circle centre: CSS mirrors these offsets (±6.5px bring the
 * 13px rings' centres exactly onto the block border). */
export function portCenter(rect: BlockRect, role: PortRole): PortPoint {
  const horizontal = (role: PortRole): boolean => {
    switch (role) {
      case "inLeft":
      case "outRight":
      case "joinOut":
        return true;
      default:
        return false;
    }
  };
  switch (role) {
    case "inLeft":
      return { x: rect.x, y: rect.y + rect.h / 2, horizontal: horizontal(role) };
    case "outRight":
      return {
        x: rect.x + rect.w,
        y: rect.y + rect.h / 2,
        horizontal: horizontal(role),
      };
    case "inTop":
      return {
        x: rect.x + rect.w / 2,
        y: rect.y,
        horizontal: horizontal(role),
      };
    case "outBottom":
      return {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h,
        horizontal: horizontal(role),
      };
    case "then":
      return {
        x: rect.x + rect.w * BRANCH_PORT_FRACTION.then,
        y: rect.y + rect.h,
        horizontal: horizontal(role),
      };
    case "else":
      return {
        x: rect.x + rect.w * BRANCH_PORT_FRACTION.else,
        y: rect.y + rect.h,
        horizontal: horizontal(role),
      };
    case "joinIn":
      return {
        x: rect.x + rect.w / 2,
        y: rect.y,
        horizontal: horizontal(role),
      };
    case "joinOut":
      return {
        x: rect.x + rect.w,
        y: rect.y + rect.h / 2,
        horizontal: horizontal(role),
      };
  }
}

/** One edge drawn between two port circles. `horizontal` bends the Bézier
 * the way the ports read (side ports slide horizontally, vertical flow
 * lines curve downward). */
export function portEdgeEnds(
  a: BlockRect,
  b: BlockRect,
  fromRole: PortRole,
  toRole: PortRole,
): EdgeEnds {
  const from = portCenter(a, fromRole);
  const to = portCenter(b, toRole);
  // Horizontal reads: into a side port. A top in-port belongs to the
  // vertical body flow (branch heads and column links), and the `if`
  // card's own input is its *left* side port — it carries no top
  // in-port — so every wire into an `if` reads through the side pair.
  const isHorizontal = toRole === "inLeft";
  return {
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    horizontal: isHorizontal,
  };
}

/** The chain edge between two ordinary blocks: out of the source's right
 * out-port, into the target's left in-port. */
export function edgeEnds(a: BlockRect, b: BlockRect): EdgeEnds {
  return portEdgeEnds(a, b, "outRight", "inLeft");
}

/** Cubic Bézier for vertical edges: down from the source, into the
 * target's top edge. */
export function verticalEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const bend = Math.max(32, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 3);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

/** Smooth cubic Bézier from source port to target port. */
export function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontal = false,
): string {
  if (horizontal) {
    const bend = Math.max(32, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }
  const bend = Math.max(32, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

/** A branch wire leaves the `if` card through its bottom TRUE/FALSE
 * port and enters the first body block through its *top* edge: a branch
 * body runs downward, so the wire enters where the reading starts. */
export function branchEdgeEnds(
  a: BlockRect,
  b: BlockRect,
  branch: "then" | "else",
): EdgeEnds {
  return portEdgeEnds(a, b, branch === "then" ? "then" : "else", "inTop");
}

/** A column link (a branch member that chains to the next member of the
 * same branch) goes from the member's bottom edge to the next member's
 * top edge — the body's vertical flow line. */
export function columnEdgeEnds(a: BlockRect, b: BlockRect): EdgeEnds {
  return portEdgeEnds(a, b, "outBottom", "inTop");
}
