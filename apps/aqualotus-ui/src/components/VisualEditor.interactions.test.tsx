import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import VisualEditor from "./VisualEditor";
import type { CommandSummary } from "../lib/optilotus";
import type { FlowState } from "../lib/flow";

/**
 * The canvas interactions the editor really implements: dragging a
 * block, selecting it, moving it across the board, and the geometry of
 * the connections that follow it.
 */

const MAIN_COMMANDS: readonly CommandSummary[] = [
  { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
  { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
  { id: 3, kind: "print", next: null, template: '"{n}"' },
];

function baseProps(): React.ComponentProps<typeof VisualEditor> {
  return {
    functions: [{ id: 0, name: "main", isMain: true }],
    commandsByFunction: { 0: MAIN_COMMANDS },
    layoutStore: {
      0: {
        1: { x: 48, y: 84 },
        2: { x: 48, y: 240 },
        3: { x: 48, y: 396 },
      },
    },
    selectedFunctionId: 0,
    selectedCommandId: null,
    errorId: null,
    errorFunctionId: null,
    busy: false,
    onSelectFunction: vi.fn(),
    onSelectCommand: vi.fn(),
    onReconnect: vi.fn(() => true),
    onMoveBlock: vi.fn(),
    onDropBlock: vi.fn(),
    onRegisterDrop: vi.fn(),
    onRegisterZoom: vi.fn(),
    onRequestLibrary: vi.fn(),
  };
}

/** The board element the pointer gestures happen on. */
function board(container: HTMLElement): HTMLElement {
  const el = container.querySelector("#board");
  if (el === null) throw new Error("no board");
  return el as HTMLElement;
}

/** The block element of a command. */
function block(container: HTMLElement, id: number): HTMLElement {
  const el = container.querySelector(`[data-block-id="${id}"]`);
  if (el === null) throw new Error("no block");
  return el as HTMLElement;
}

/** Flush the coalesced pointer move (one animation frame). */
function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

describe("VisualEditor interactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a block with the pointer and commits the new position", () => {
    const props = baseProps();
    const { container } = render(<VisualEditor {...props} />);
    const target = block(container, 1);
    const canvas = board(container);

    fireEvent.pointerDown(target, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 200,
      clientY: 160,
    });
    flushFrame();
    // The block follows the pointer while the gesture is live.
    expect(block(container, 1).getAttribute("style")).toContain("148px");
    expect(block(container, 1).getAttribute("style")).toContain("144px");

    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 200,
      clientY: 160,
    });
    expect(props.onMoveBlock).toHaveBeenCalledWith(0, 1, { x: 148, y: 144 });
  });

  it("keeps a dragged block inside the canvas", () => {
    const onMoveBlock = vi.fn();
    const { container } = render(
      <VisualEditor {...baseProps()} onMoveBlock={onMoveBlock} />,
    );
    const target = block(container, 1);
    const canvas = board(container);

    fireEvent.pointerDown(target, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    // Far beyond the top-left corner: the block may not leave the canvas.
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: -500,
      clientY: -500,
    });
    flushFrame();
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: -500,
      clientY: -500,
    });
    const moved = onMoveBlock.mock.calls[0]?.[2] as { x: number; y: number };
    expect(moved.x).toBeGreaterThanOrEqual(8);
    expect(moved.y).toBeGreaterThanOrEqual(36);
  });

  it("selects a block on a click and deselects it on the next one", () => {
    const onSelectCommand = vi.fn();
    const props = baseProps();
    const { container, rerender } = render(
      <VisualEditor {...props} onSelectCommand={onSelectCommand} />,
    );
    const target = block(container, 1);
    const canvas = board(container);

    fireEvent.pointerDown(target, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(onSelectCommand).toHaveBeenCalledWith(1);

    // The block is selected now: the next click deselects it.
    onSelectCommand.mockClear();
    rerender(
      <VisualEditor {...props} selectedCommandId={1} onSelectCommand={onSelectCommand} />,
    );
    fireEvent.pointerDown(block(container, 1), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(onSelectCommand).toHaveBeenCalledWith(null);
  });

  it("commits a drag that ends outside the original block", () => {
    const props = baseProps();
    const { container } = render(<VisualEditor {...props} />);
    const target = block(container, 1);
    const canvas = board(container);

    fireEvent.pointerDown(target, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 260,
      clientY: 130,
    });
    flushFrame();
    // Released far away from where the gesture started.
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 900,
      clientY: 700,
    });
    expect(props.onMoveBlock).toHaveBeenCalledWith(0, 1, { x: 208, y: 114 });
  });

  it("keeps the connection on the block that moved", () => {
    const props = baseProps();
    const { container, rerender } = render(<VisualEditor {...props} />);
    const before =
      container.querySelector("path.edge")?.getAttribute("d") ?? "";

    // The block was dropped at a new spot: the layout follows.
    rerender(
      <VisualEditor
        {...props}
        layoutStore={{
          0: {
            1: { x: 400, y: 84 },
            2: { x: 48, y: 240 },
            3: { x: 48, y: 396 },
          },
        }}
      />,
    );
    const after = container.querySelector("path.edge")?.getAttribute("d") ?? "";
    expect(after).not.toBe(before);
    // The connection still starts at the moved block: the path starts
    // exactly where the block moved to (world coordinates).
    const startX = Number(after.slice(2).split(" ")[0]);
    const beforeX = Number(before.slice(2).split(" ")[0]);
    expect(startX - beforeX).toBe(352);
  });

  it("stays interactive while the execution travel runs", () => {
    const props = baseProps();
    const flow: FlowState = {
      runId: 1,
      edges: [{ fid: 0, from: 1, to: 2, kind: "chain" }],
      linkMs: 300,
    };
    const { container } = render(<VisualEditor {...props} flow={flow} />);
    const canvas = board(container);

    // The travel is running…
    act(() => {
      vi.advanceTimersByTime(32);
    });
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(1);

    // …and the canvas still reacts to the pointer.
    fireEvent.pointerDown(block(container, 1), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      clientX: 200,
      clientY: 160,
    });
    flushFrame();
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: 200,
      clientY: 160,
    });
    expect(props.onMoveBlock).toHaveBeenCalledWith(0, 1, { x: 148, y: 144 });
  });

  it("removes the block and its connection when the model drops it", () => {
    const props = baseProps();
    const { container, rerender } = render(<VisualEditor {...props} />);
    expect(container.querySelectorAll(".vblock").length).toBe(3);
    expect(container.querySelectorAll("path.edge").length).toBe(2);

    // The middle block is gone from the program.
    rerender(
      <VisualEditor
        {...props}
        commandsByFunction={{
          0: [MAIN_COMMANDS[0], MAIN_COMMANDS[2]],
        }}
      />,
    );
    // The connection that pointed at it is gone as well.
    const edges = container.querySelectorAll("path.edge");
    expect(edges.length).toBe(0);
  });
});

/**
 * A vertical If/Else fixture for the branch gestures: an `if` whose
 * TRUE body holds two prints and whose FALSE body is empty, plus the
 * continuation print. Member positions sit below the card so the
 * derived frames (and every drag maths below) stay deterministic with
 * the fallback block size (216×104 in jsdom).
 */
const IF_GESTURE_COMMANDS: readonly CommandSummary[] = [
  { id: 2, kind: "if", next: 5, then_body: [3, 4], else_body: [] },
  { id: 3, kind: "print", next: 4, template: '"a"' },
  { id: 4, kind: "print", next: null, template: '"b"' },
  { id: 5, kind: "print", next: null, template: '"after"' },
];

const IF_GESTURE_LAYOUT = {
  0: {
    2: { x: 48, y: 84 },
    3: { x: 300, y: 470 },
    4: { x: 300, y: 620 },
    5: { x: 48, y: 900 },
  },
} as const;

describe("VisualEditor branch gestures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drags a whole TRUE/FALSE container with all of its members", () => {
    const onMoveBlock = vi.fn();
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_GESTURE_COMMANDS }}
        layoutStore={IF_GESTURE_LAYOUT}
        onMoveBlock={onMoveBlock}
      />,
    );
    const frame = container.querySelector(
      '.vbranch[data-if-branch="then"][data-fid="0"]',
    );
    expect(frame).not.toBeNull();
    const beforeLeft = (frame as HTMLElement).style.left;
    expect(beforeLeft).toBe("286px"); // members 300..516 minus pad 14
    const tag = frame?.querySelector(".vbranch-tag") as HTMLElement;
    const pane = board(container);

    // Grab the frame's blank chip, drag right/down, and watch the whole
    // branch follow live: both members and the frame shift together.
    fireEvent.pointerDown(tag, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(pane, { pointerId: 1, clientX: 160, clientY: 140 });
    flushFrame();
    expect((frame as HTMLElement).style.left).toBe("346px");
    expect((frame as HTMLElement).style.top).toBe("488px");
    const movedThree = container.querySelector('[data-block-id="3"]');
    expect(movedThree?.getAttribute("style")).toContain("360px");
    expect(movedThree?.getAttribute("style")).toContain("510px");
    const movedFour = container.querySelector('[data-block-id="4"]');
    expect(movedFour?.getAttribute("style")).toContain("360px");
    expect(movedFour?.getAttribute("style")).toContain("660px");
    // Nothing outside the branch moves.
    expect(
      container.querySelector('[data-block-id="5"]')?.getAttribute("style"),
    ).toContain("900px");

    // Release: every member's dropped position commits individually.
    fireEvent.pointerUp(pane, { pointerId: 1, clientX: 160, clientY: 140 });
    expect(onMoveBlock).toHaveBeenCalledWith(0, 3, { x: 360, y: 510 });
    expect(onMoveBlock).toHaveBeenCalledWith(0, 4, { x: 360, y: 660 });
    const movedIds = onMoveBlock.mock.calls.map((call) => call[1]);
    expect(movedIds).toEqual([3, 4]);
  });

  it("drags the merge-join circle from its stored spot and commits it", () => {
    const onMoveJoin = vi.fn();
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_GESTURE_COMMANDS }}
        layoutStore={IF_GESTURE_LAYOUT}
        mergeJoins={{ 2: { on: true, pos: { x: 200, y: 400 } } }}
        onMoveJoin={onMoveJoin}
      />,
    );
    const join = container.querySelector('.vjoin[data-join-of="2"]');
    expect(join).not.toBeNull();
    expect((join as HTMLElement).style.left).toBe("200px");
    const pane = board(container);

    fireEvent.pointerDown(join as HTMLElement, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(pane, { pointerId: 1, clientX: 140, clientY: 130 });
    flushFrame();
    // The pill follows the pointer while the gesture is live…
    expect((join as HTMLElement).style.left).toBe("240px");
    expect((join as HTMLElement).style.top).toBe("430px");
    expect((join as HTMLElement).getAttribute("data-dragging")).toBe("true");

    // …and the dropped spot persists as UI state for this `if` only.
    fireEvent.pointerUp(pane, { pointerId: 1, clientX: 140, clientY: 130 });
    expect(onMoveJoin).toHaveBeenCalledTimes(1);
    expect(onMoveJoin).toHaveBeenCalledWith(2, { x: 240, y: 430 });
  });
});
