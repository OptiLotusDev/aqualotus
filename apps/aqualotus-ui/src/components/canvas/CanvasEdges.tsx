/**
 * Canvas edges: SVG edge rendering, edge classes, arrow markers,
 * connection preview paths, FlowTravel rendering, and SVG path refs
 * required by animation. Supports both full-world SVG (before viewport
 * measurement) and viewport-sized SVG overlay.
 */

import { Fragment, type ReactElement } from "react";
import type { CanvasDrawnEdge } from "../../lib/canvas_edges";
import type { TravelEdge } from "../../hooks/canvas/useCanvasTravelEdges";
import FlowTravel from "../FlowTravel";

interface CanvasEdgesProps {
  readonly edges: readonly CanvasDrawnEdge[];
  readonly travelEdges: readonly TravelEdge[];
  readonly drawing: ReadonlySet<string>;
  readonly selectedCommandId: number | null;
  readonly selectedFunctionId: number | null;
  readonly edgeRefs: React.MutableRefObject<Map<string, SVGPathElement>>;
  readonly reduced: boolean;
  readonly linkMs: number;
  readonly runId: number;
  readonly previewElement: ReactElement | null;
  readonly viewport: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  readonly worldW: number;
  readonly worldH: number;
}

function edgeNode(
  edge: CanvasDrawnEdge,
  selectedCommandId: number | null,
  selectedFunctionId: number | null,
  drawing: ReadonlySet<string>,
  edgeRefs: React.MutableRefObject<Map<string, SVGPathElement>>,
): ReactElement {
  const isSelected =
    edge.from === selectedCommandId && edge.fid === selectedFunctionId;
  const isDrawing = drawing.has(edge.key);
  const edgeClass = [
    "edge",
    isSelected ? "edge-selected" : "",
    edge.planned ? "edge-planned" : "",
    edge.merge ? "edge-merge" : "",
    isDrawing ? "edge-draw" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
  return (
    <Fragment key={edge.key}>
      <path
        d={edge.d}
        data-fid={edge.fid}
        data-from={edge.from}
        data-to={edge.to}
        pathLength={1}
        markerEnd={isDrawing ? undefined : "url(#arrow-flow)"}
        className={edgeClass}
        ref={(el) => {
          if (el !== null) {
            edgeRefs.current.set(edge.key, el);
          } else {
            edgeRefs.current.delete(edge.key);
          }
        }}
      />
      {isDrawing ? (
        <path
          d={edge.d}
          pathLength={1}
          markerEnd="url(#arrow-flow)"
          className="edge-draw-head"
        />
      ) : null}
    </Fragment>
  );
}

export default function CanvasEdges(
  props: CanvasEdgesProps,
): ReactElement {
  const {
    edges,
    travelEdges,
    drawing,
    selectedCommandId,
    selectedFunctionId,
    edgeRefs,
    reduced,
    linkMs,
    runId,
    previewElement,
    viewport,
    worldW,
    worldH,
  } = props;

  const svgContent = (
    <>
      <defs>
        <marker
          id="arrow-flow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" className="marker-flow" />
        </marker>
      </defs>
      {edges.map((edge) =>
        edgeNode(edge, selectedCommandId, selectedFunctionId, drawing, edgeRefs),
      )}
      <FlowTravel
        edges={travelEdges}
        paths={edgeRefs.current}
        linkMs={linkMs}
        runId={runId}
        reduced={reduced}
      />
      {previewElement}
    </>
  );

  if (viewport === null) {
    return (
      <svg
        id="links"
        className="links"
        width={worldW}
        height={worldH}
        aria-hidden="true"
      >
        {svgContent}
      </svg>
    );
  }
  return (
    <svg
      id="links"
      className="links"
      style={{ left: viewport.x, top: viewport.y }}
      width={viewport.w}
      height={viewport.h}
      aria-hidden="true"
    >
      <g transform={`translate(${-viewport.x} ${-viewport.y})`}>
        {svgContent}
      </g>
    </svg>
  );
}
