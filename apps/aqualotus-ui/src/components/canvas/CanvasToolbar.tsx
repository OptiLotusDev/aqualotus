/**
 * Canvas toolbar: breadcrumb/title, block count, culling count, zoom
 * controls, fit button, optional extra content, and status hint.
 * Pure presentation — all interaction via callbacks.
 */

import type { ReactElement, ReactNode } from "react";
import type { FunctionSummary } from "../../lib/optilotus";
import { PACKAGE_NAME, PRESENTATION_STRUCT_NAME } from "../../lib/workspace";

interface CanvasToolbarProps {
  readonly selectedFunc: FunctionSummary | null;
  readonly selectedCount: number;
  readonly culledBlocks: number;
  readonly zoom: number;
  readonly hint: string;
  readonly toolbarExtra?: ReactNode;
  readonly onZoomOut: () => void;
  readonly onZoomReset: () => void;
  readonly onZoomIn: () => void;
  readonly onFitView: () => void;
}

export default function CanvasToolbar(
  props: CanvasToolbarProps,
): ReactElement {
  const {
    selectedFunc,
    selectedCount,
    culledBlocks,
    zoom,
    hint,
    toolbarExtra,
    onZoomOut,
    onZoomReset,
    onZoomIn,
    onFitView,
  } = props;
  return (
    <div
      className="canvas-toolbar enter-down enter-delay-heading"
      role="toolbar"
      aria-label="Canvas view"
    >
      <span className="canvas-title" title="Package / Struct / Function">
        <span className="crumb">{PACKAGE_NAME}</span>
        <span className="crumb-sep" aria-hidden="true">/</span>
        <span className="crumb">{PRESENTATION_STRUCT_NAME}</span>
        <span className="crumb-sep" aria-hidden="true">/</span>
        <span className="crumb crumb-strong">
          {selectedFunc !== null ? `${selectedFunc.name}()` : "—"}
        </span>
        {selectedFunc?.isMain ? <span className="main-badge">MAIN</span> : null}
        <span className="cmd-count enter-up enter-delay-meta">
          {selectedCount} {selectedCount === 1 ? "block" : "blocks"}
        </span>
        {culledBlocks > 0 ? (
          <span
            className="cull-count"
            title="Off-screen blocks are unmounted to keep WebKit compositing cheap; the program graph is unaffected"
          >
            {culledBlocks} culled
          </span>
        ) : null}
      </span>
      <span className="canvas-tools">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="Zoom out"
          onClick={onZoomOut}
        >
          −
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={`Zoom level ${Math.round(zoom * 100)} percent. Activate to reset zoom to 100 percent.`}
          onClick={onZoomReset}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="Zoom in"
          onClick={onZoomIn}
        >
          +
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onFitView}
        >
          Fit
        </button>
      </span>
      {toolbarExtra !== undefined ? (
        <span className="toolbar-extra">{toolbarExtra}</span>
      ) : null}
      {hint !== "" ? (
        <span className="canvas-hint" role="status">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
