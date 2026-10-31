import { useEffect, useRef, type ReactElement } from "react";

/**
 * The travelling execution indicator.
 *
 * A simple solid white circle travels along each connection path in order.
 * Radius: 4, Fill: #ffffff, Opacity: 1, Duration: 500ms per connection.
 * No glow, trail, or effects.
 */

interface FlowTravelEdge {
  readonly key: string;
  readonly selected: boolean;
}

interface FlowTravelProps {
  readonly edges: readonly FlowTravelEdge[];
  readonly paths: ReadonlyMap<string, SVGPathElement>;
  readonly linkMs: number;
  readonly runId: number;
  readonly reduced: boolean;
}

const DOT_R = 4;
const FILL = "#ffffff";

export default function FlowTravel(props: FlowTravelProps): ReactElement {
  const { edges, paths, linkMs, runId, reduced } = props;
  const groupRef = useRef<SVGGElement | null>(null);
  const edgesRef = useRef<readonly FlowTravelEdge[]>(edges);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (reduced || edgesRef.current.length === 0) return;

    const lengths = new Map<string, { d: string; len: number }>();
    let frame = 0;
    let start: number | null = null;

    const step = (now: number): void => {
      const group = groupRef.current;
      if (group === null) return;
      if (start === null) start = now;
      const elapsed = now - start;
      let travelling = false;

      edgesRef.current.forEach((edge, index) => {
        const path = paths.get(edge.key);
        const dot = group.children[index] as SVGCircleElement | undefined;
        if (path === undefined || dot === undefined) return;

        const offset = index * linkMs;
        const local = elapsed - offset;

        if (local < 0) {
          dot.style.opacity = "0";
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
        dot.setAttribute("cx", String(point.x));
        dot.setAttribute("cy", String(point.y));
        dot.style.opacity = "1";

        if (progress >= 1) {
          dot.style.opacity = "0";
          return;
        }
        travelling = true;
      });

      if (travelling) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [runId, linkMs, reduced, paths]);

  useEffect(() => {
    const group = groupRef.current;
    if (group === null) return;
    for (let i = 0; i < group.children.length; i += 1) {
      (group.children[i] as SVGCircleElement).style.opacity = "0";
    }
  }, [edges]);

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
