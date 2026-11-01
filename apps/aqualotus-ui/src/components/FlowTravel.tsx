import { useEffect, useRef, type ReactElement } from "react";

/**
 * The travelling execution indicator.
 *
 * A simple solid white circle travels along each connection path in order.
 * Radius: 4, Fill: #ffffff, Opacity: 1, Duration: 500ms per connection.
 * No glow, trail, or effects.
 *
 * When the run waits on input, one connection carries a pause mark: the
 * indicator stops at that connection's end — the input block's entry
 * side — and stays there, visible and still, for the whole wait. The
 * animation clock stops with it; nothing past the input moves, however
 * many frames pass or however long the user takes. When the wait ends
 * the same indicator continues: the clock restarts from the hold, the
 * held connection completes the way every connection does, and the next
 * links travel in the same rhythm as before the pause. A new run bumps
 * `runId`, which restarts the sweep from the first link instead of
 * realigning.
 */

interface FlowTravelEdge {
  readonly key: string;
  readonly selected: boolean;
  /** The run waits on input at this connection's end. */
  readonly pause?: boolean;
}

interface FlowTravelProps {
  readonly edges: readonly FlowTravelEdge[];
  readonly paths: ReadonlyMap<string, SVGPathElement>;
  readonly linkMs: number;
  readonly runId: number;
  readonly reduced: boolean;
  /**
   * The key of the paused connection, `null` when no run waits. Derived
   * from the edges above; a change of it is what resumes or re-pauses
   * the animation.
   */
  readonly pauseKey?: string | null;
}

const DOT_R = 4;
const FILL = "#ffffff";

export default function FlowTravel(props: FlowTravelProps): ReactElement {
  const { edges, paths, linkMs, runId, reduced, pauseKey = null } = props;
  const groupRef = useRef<SVGGElement | null>(null);
  const edgesRef = useRef<readonly FlowTravelEdge[]>(edges);
  // The connection the indicator is held on (the run pauses on input at
  // its end), remembered across renders so a changed pause realigns the
  // clock at that connection's slot instead of restarting the sweep.
  const holdRef = useRef<string | null>(null);
  const runIdRef = useRef<number>(runId);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (reduced || edgesRef.current.length === 0) return;

    const lengths = new Map<string, { d: string; len: number }>();
    const isNewRun = runIdRef.current !== runId;
    runIdRef.current = runId;
    const previousHold = holdRef.current;
    holdRef.current = null;
    // Resuming from a hold: anchor the clock at the end of the held
    // connection's slot, so the next link starts where the run would
    // have been had the wait never happened, and the held indicator
    // fades exactly the way a completed link does. A new run starts its
    // own clock; a hold whose connection vanished (the path was rebuilt
    // around it) has nothing to anchor to and starts fresh.
    let anchor = 0;
    if (!isNewRun && previousHold !== null) {
      const heldIndex = edgesRef.current.findIndex(
        (edge) => edge.key === previousHold,
      );
      if (heldIndex >= 0) anchor = (heldIndex + 1) * linkMs;
    }
    let frame = 0;
    let start: number | null = null;
    let held = false;

    const step = (now: number): void => {
      const group = groupRef.current;
      if (group === null) return;
      if (start === null) start = now;
      let elapsed = now - start + anchor;
      let travelling = false;

      const chain = edgesRef.current;
      for (let index = 0; index < chain.length; index += 1) {
        const edge = chain[index];
        const path = paths.get(edge.key);
        const dot = group.children[index] as SVGCircleElement | undefined;
        if (path === undefined || dot === undefined) continue;

        const offset = index * linkMs;
        const local = elapsed - offset;

        if (local < 0) {
          dot.style.opacity = "0";
          continue;
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
        dot.setAttribute("cx", String(point.x));
        dot.setAttribute("cy", String(point.y));

        if (progress < 1) {
          dot.style.opacity = "1";
          travelling = true;
          continue;
        }
        if (edge.pause === true) {
          // The engine waits for input here: the indicator stops at
          // this connection's end — the block's entry side — and the
          // clock stops with it. Later connections are not even
          // touched, and no further frame runs while the run waits.
          dot.style.opacity = "1";
          holdRef.current = edge.key;
          held = true;
          break;
        }
        dot.style.opacity = "0";
      }

      if (travelling && !held) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [runId, linkMs, reduced, paths, pauseKey]);

  useEffect(() => {
    const group = groupRef.current;
    if (group === null) return;
    // While the run waits on input, the held indicator survives every
    // re-render of the canvas: the geometry may be redrawn around it
    // (the held connection then re-measures), but it never goes dark.
    const heldKey = holdRef.current;
    const heldIndex =
      heldKey === null
        ? -1
        : edgesRef.current.findIndex((edge) => edge.key === heldKey);
    for (let i = 0; i < group.children.length; i += 1) {
      if (i === heldIndex) continue;
      (group.children[i] as SVGCircleElement).style.opacity = "0";
    }
    if (heldIndex >= 0) {
      const edge = edgesRef.current[heldIndex];
      const path = edge === undefined ? undefined : paths.get(edge.key);
      const dot = group.children[heldIndex] as SVGCircleElement | undefined;
      if (path !== undefined && dot !== undefined) {
        const point = path.getPointAtLength(path.getTotalLength());
        dot.setAttribute("cx", String(point.x));
        dot.setAttribute("cy", String(point.y));
        dot.style.opacity = "1";
      }
    }
  }, [edges, paths]);

  return (
    <g className="flow-travel" ref={groupRef} aria-hidden="true">
      {edges.map((edge) => (
        <circle
          key={edge.key}
          className="flow-dot"
          r={DOT_R}
          fill={FILL}
          opacity={0}
        />
      ))}
    </g>
  );
}
