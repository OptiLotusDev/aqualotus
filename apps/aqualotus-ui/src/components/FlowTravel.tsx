import { Fragment, useEffect, useRef, type ReactElement } from "react";

/**
 * The travelling execution indicator.
 *
 * The OptiLotus design guide draws the run as "a dot travels each link
 * in order": the indicator rides the *actual* SVG path of a connection,
 * its position is read from the path geometry (`getTotalLength()` and
 * `getPointAtLength()`), and the links are travelled one after another,
 * in execution order. This component is that behaviour inside Aqualotus:
 *
 * - one `requestAnimationFrame` loop drives every indicator of the run
 *   (never one loop per link), and it is cancelled on unmount, on a new
 *   run, and when the flow ends — no stale indicators survive;
 * - the connection keeps its own look: the indicator is drawn in the
 *   colour of the connection it rides (the same tokens the connection
 *   uses), so solid and dashed connections stay distinguishable;
 * - the connection itself never changes: colour, stroke width,
 *   endpoints and routing are untouched;
 * - reduced motion drops the travel (the guide: "keep the fades, drop
 *   the travel") — the run still reports its result, nothing moves.
 */

/** One connection the indicator rides. */
export interface FlowTravelEdge {
  /** Key of the connection (matches the rendered connection path). */
  readonly key: string;
  /** Selected connections glow in the selected colour. */
  readonly selected: boolean;
}

interface FlowTravelProps {
  /** Connections to travel, in execution order. */
  readonly edges: readonly FlowTravelEdge[];
  /** The rendered connection paths, keyed like the edges. */
  readonly paths: ReadonlyMap<string, SVGPathElement>;
  /** Travel time of one connection, in milliseconds. */
  readonly linkMs: number;
  /** Identifies the run: a new run restarts the travel. */
  readonly runId: number;
  /** Reduced motion: keep the fades, drop the travel. */
  readonly reduced: boolean;
}

/** Radius of the luminous head. */
const DOT_R = 4.5;
/** Radius of the short trailing glow behind the head. */
const TRAIL_R = 3;
/** How far behind the head the trail sits, as a share of the path. */
const TRAIL_GAP = 0.06;

export default function FlowTravel(props: FlowTravelProps): ReactElement {
  const { edges, paths, linkMs, runId, reduced } = props;
  const groupRef = useRef<SVGGElement | null>(null);
  // The current edges are read by the animation loop, not by the render:
  // a re-render must not restart a running travel.
  const edgesRef = useRef<readonly FlowTravelEdge[]>(edges);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    // Reduced motion: the guide drops the travel entirely.
    if (reduced || edgesRef.current.length === 0) return;
    // The path length of a connection is measured once and reused until
    // the path itself changes (a moved block changes its geometry).
    const lengths = new Map<string, { d: string; len: number }>();
    let frame = 0;
    // The first frame is the start of the travel.
    let start: number | null = null;

    const step = (now: number): void => {
      const group = groupRef.current;
      if (group === null) return;
      if (start === null) start = now;
      const elapsed = now - start;
      let travelling = false;
      edgesRef.current.forEach((edge, index) => {
        const path = paths.get(edge.key);
        const head = group.children[index * 2 + 1];
        const trail = group.children[index * 2];
        if (path === undefined || head === undefined || trail === undefined) {
          return;
        }
        const offset = index * linkMs;
        const local = elapsed - offset;
        // Before its turn: nothing to show yet.
        if (local < 0) {
          hide(head, trail);
          return;
        }
        const progress = Math.min(1, local / linkMs);
        const d = path.getAttribute("d") ?? "";
        const cached = lengths.get(edge.key);
        let len = cached?.len ?? 0;
        if (cached === undefined || cached.d !== d) {
          len = path.getTotalLength();
          lengths.set(edge.key, { d, len });
        }
        const point = path.getPointAtLength(len * progress);
        head.setAttribute("cx", String(point.x));
        head.setAttribute("cy", String(point.y));
        head.setAttribute("opacity", "1");
        const behind = path.getPointAtLength(
          len * Math.max(0, progress - TRAIL_GAP),
        );
        trail.setAttribute("cx", String(behind.x));
        trail.setAttribute("cy", String(behind.y));
        trail.setAttribute("opacity", "0.45");
        // The link is travelled: the indicator leaves the path, as the
        // design guide's dot does when it reaches the end.
        if (progress >= 1) {
          hide(head, trail);
          return;
        }
        travelling = true;
      });
      if (travelling) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [runId, linkMs, reduced, paths]);

  // A link that is not travelling shows nothing.
  useEffect(() => {
    const group = groupRef.current;
    if (group === null) return;
    for (let i = 0; i < group.children.length; i += 1) {
      group.children[i].setAttribute("opacity", "0");
    }
  }, [edges]);

  return (
    <g className="flow-travel" ref={groupRef} aria-hidden="true">
      {edges.map((edge) => (
        <Fragment key={edge.key}>
          <circle
            className={`flow-trail${edge.selected ? " edge-selected" : ""}`}
            r={TRAIL_R}
            opacity={0}
          />
          <circle
            className={`flow-dot${edge.selected ? " edge-selected" : ""}`}
            r={DOT_R}
            opacity={0}
          />
        </Fragment>
      ))}
    </g>
  );
}

/** Hide one indicator pair. */
function hide(head: Element, trail: Element): void {
  head.setAttribute("opacity", "0");
  trail.setAttribute("opacity", "0");
}
