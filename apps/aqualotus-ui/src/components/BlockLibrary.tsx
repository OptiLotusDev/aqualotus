import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import {
  BLOCK_CATEGORIES,
  filterBlocks,
  type BlockDefinition,
} from "../lib/blocks";

interface BlockLibraryProps {
  readonly busy: boolean;
  readonly onAdd: (kind: string) => void;
  readonly onDropToCanvas: (kind: string, clientX: number, clientY: number) => void;
}

interface Ghost {
  readonly kind: string;
  readonly label: string;
  readonly category: string;
  readonly x: number;
  readonly y: number;
}

const DRAG_THRESHOLD_PX = 8;

/**
 * Language block library: search + collapsible categories, exactly the
 * `docs/api.md` surface. Click (or tap) adds a real bridge entity at an
 * automatic position; dragging (mouse) shows a ghost under the cursor
 * and drops the block onto the canvas.
 */
export default function BlockLibrary(props: BlockLibraryProps): ReactElement {
  const { busy, onAdd, onDropToCanvas } = props;
  const [query, setQuery] = useState<string>("");
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const dragRef = useRef<{
    kind: string;
    label: string;
    category: string;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressClickRef = useRef<boolean>(false);
  const callbacksRef = useRef({ onDropToCanvas });

  useEffect(() => {
    callbacksRef.current = { onDropToCanvas };
  }, [onDropToCanvas]);

  // Global pointer tracking while a library drag is in flight.
  // Listeners stay attached; dragRef gates them. Ghost visibility is
  // mirrored in a ref so drop handling never runs inside a state
  // updater (StrictMode would double-fire side effects there).
  useEffect(() => {
    function onMove(e: PointerEvent): void {
      const drag = dragRef.current;
      if (drag === null || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      const next: Ghost = {
        kind: drag.kind,
        label: drag.label,
        category: drag.category,
        x: e.clientX,
        y: e.clientY,
      };
      ghostRef.current = next;
      setGhost(next);
    }
    function endDrag(e: PointerEvent, cancelled: boolean): void {
      const drag = dragRef.current;
      if (drag === null || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      const hadGhost = ghostRef.current !== null;
      ghostRef.current = null;
      setGhost(null);
      if (!hadGhost) return;
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
      if (cancelled) return;
      if (typeof document.elementFromPoint !== "function") return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const board = el instanceof Element ? el.closest("#board") : null;
      if (board !== null) {
        callbacksRef.current.onDropToCanvas(drag.kind, e.clientX, e.clientY);
      }
    }
    function onUp(e: PointerEvent): void {
      endDrag(e, false);
    }
    function onCancel(e: PointerEvent): void {
      endDrag(e, true);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  function beginDrag(
    e: React.PointerEvent<HTMLButtonElement>,
    block: BlockDefinition,
  ): void {
    if (busy || e.button !== 0) return;
    if (e.pointerType === "mouse") {
      // Avoid text selection while a mouse drag is in flight.
      e.preventDefault();
    }
    dragRef.current = {
      kind: block.kind,
      label: block.label,
      category: block.category,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
  }

  function swallowDragClick(e: React.MouseEvent): void {
    if (suppressClickRef.current) {
      e.stopPropagation();
      e.preventDefault();
      suppressClickRef.current = false;
    }
  }

  function renderItem(block: BlockDefinition): ReactElement {
    return (
      <button
        type="button"
        className="lib-item"
        data-category={block.category}
        disabled={busy}
        aria-label={`Add ${block.label} block`}
        title={block.description}
        onPointerDown={(e) => beginDrag(e, block)}
        onClickCapture={swallowDragClick}
        onClick={() => onAdd(block.kind)}
      >
        <span className="lib-dash" aria-hidden="true" />
        <span className="lib-name">{block.label}</span>
      </button>
    );
  }

  const matches = filterBlocks(query);
  const searching = query.trim() !== "";

  return (
    <div className="library">
      <div className="field">
        <span>
          <label htmlFor="lib-search">Search blocks</label>
        </span>
        <input
          id="lib-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search blocks…"
          autoComplete="off"
        />
      </div>
      {matches.length === 0 ? (
        <div className="empty">
          <strong>No blocks match</strong>
          <span>Try a different search term.</span>
        </div>
      ) : searching ? (
        <ul className="lib-flat" aria-label="Matching blocks">
          {matches.map((b) => (
            <li key={b.kind}>{renderItem(b)}</li>
          ))}
        </ul>
      ) : (
        BLOCK_CATEGORIES.map((category) => {
          const items = matches.filter((b) => b.category === category);
          if (items.length === 0) return null;
          return (
            <details
              key={category}
              className="lib-category"
              open={
                category === "Program" ||
                category === "Variables" ||
                category === "Output"
              }
            >
              <summary>{category}</summary>
              <ul className="lib-flat" aria-label={`${category} blocks`}>
                {items.map((b) => (
                  <li key={b.kind}>{renderItem(b)}</li>
                ))}
              </ul>
            </details>
          );
        })
      )}
      {ghost !== null
        ? createPortal(
            <div
              className="lib-ghost"
              data-category={ghost.category}
              style={{ left: ghost.x, top: ghost.y }}
              aria-hidden="true"
            >
              <span className="lib-dash" aria-hidden="true" />
              <span className="lib-name">{ghost.label}</span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
