import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import VisualEditor from "../../components/VisualEditor";
import type { UiCommand } from "../../lib/program";
import type { FlowState } from "../../lib/flow";
import { JOIN_FALLBACK_SIZE } from "../../lib/graph";

const HELPER_COMMANDS: readonly UiCommand[] = [
  { id: 1, kind: "declare", next: null, var: "m", ty: "int32", expr: "1" },
];

function baseProps(): React.ComponentProps<typeof VisualEditor> {
  return {
    functions: [
      { id: 0, name: "main", isMain: true },
      { id: 1, name: "helper", isMain: false },
    ],
    commandsByFunction: { 0: [], 1: HELPER_COMMANDS },
    layoutStore: { 0: {}, 1: { 1: { x: 48, y: 84 } } },
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

const BLOCK_W = 216;
const BLOCK_H = 104;
const IF_LOCAL_X = 48;
const IF_LOCAL_Y = 84;
const IF_LOCAL_H = 104; // jsdom fallback block height
const CONT_BLOCK_LOCAL_X = 48;
const CONT_BLOCK_LOCAL_Y = 700;

function pathEndpoints(d: string): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const nums = [...d.matchAll(/[-\d.]+/g)].map((m) => Number(m[0]));
  return {
    start: { x: nums[0] ?? NaN, y: nums[1] ?? NaN },
    end: { x: nums[nums.length - 2] ?? NaN, y: nums[nums.length - 1] ?? NaN },
  };
}

function renderIfWithJoin(
  pos: { x: number; y: number },
): ReturnType<typeof render> {
  const commands: readonly UiCommand[] = [
    { id: 1, kind: "if", next: 5, condition: 2, then_body: [], else_body: [] },
    { id: 5, kind: "print", next: null, template: '"after"' },
  ];
  const layoutStore = {
    0: { 1: { x: IF_LOCAL_X, y: IF_LOCAL_Y }, 5: { x: CONT_BLOCK_LOCAL_X, y: CONT_BLOCK_LOCAL_Y } },
    1: { 1: { x: 48, y: 84 } },
  };
  return render(
    <VisualEditor
      {...baseProps()}
      commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
      layoutStore={layoutStore}
      mergeJoins={{ 1: { on: true, pos } }}
    />,
  );
}

function continuationEdge(container: HTMLElement): SVGPathElement | null {
  return container.querySelector(
    '#links path.edge[data-fid="0"][data-from="1"][data-to="5"]',
  ) as SVGPathElement | null;
}

function joinRail(container: HTMLElement): SVGPathElement | null {
  return container.querySelector(
    '#links path.edge-merge[data-fid="0"][data-from="1"][data-to="1"]',
  ) as SVGPathElement | null;
}

describe("canvas geometry regression: join independence", () => {
  it("join-mode continuation starts at the join's own out port, not the if card", () => {
    const joinLeft = 400;
    const joinTop = 900;
    const { container } = renderIfWithJoin({ x: joinLeft, y: joinTop });
    const edge = continuationEdge(container);
    expect(edge).not.toBeNull();
    const { start, end } = pathEndpoints(edge?.getAttribute("d") ?? "");
    // joinOut port = right-edge centre: x = joinLeft + w, y = joinTop + h/2.
    // end = block 5 in-left: x = CONT_BLOCK_LOCAL_X, y = CONT_BLOCK_LOCAL_Y.
    // Canvas offset cancels in (start - end).
    expect(start.x - end.x).toBeCloseTo(
      joinLeft + JOIN_FALLBACK_SIZE.w - CONT_BLOCK_LOCAL_X,
      2,
    );
    expect(start.y - end.y).toBeCloseTo(
      joinTop +
        JOIN_FALLBACK_SIZE.h / 2 -
        (CONT_BLOCK_LOCAL_Y + BLOCK_H / 2),
      2,
    );
    // Regression guard: must NOT be the if card's right port.
    const ifCardRightDx = (IF_LOCAL_X + BLOCK_W) - CONT_BLOCK_LOCAL_X;
    expect(start.x - end.x).not.toBeCloseTo(ifCardRightDx, 2);
  });

  it("join input rail terminates at the join's in-top port", () => {
    const joinLeft = 400;
    const joinTop = 900;
    const { container } = renderIfWithJoin({ x: joinLeft, y: joinTop });
    const rail = joinRail(container);
    expect(rail).not.toBeNull();
    const { start, end } = pathEndpoints(rail?.getAttribute("d") ?? "");
    // Empty "then" branch rail: starts at if card's THEN port
    //   (x = if.x + w*0.3, y = if.y + h), ends at join in-top (x = joinLeft + w/2, y = joinTop).
    expect(end.x - start.x).toBeCloseTo(
      joinLeft + JOIN_FALLBACK_SIZE.w / 2 - (IF_LOCAL_X + BLOCK_W * 0.3),
      2,
    );
    expect(end.y - start.y).toBeCloseTo(
      joinTop - (IF_LOCAL_Y + IF_LOCAL_H),
      2,
    );
  });
});

describe("canvas geometry regression: edge key uniqueness", () => {
  it("edges from different functions keep distinct keys even with identical command ids", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
      { id: 2, kind: "print", next: null, template: '"n"' },
    ];
    const view = render(
      <VisualEditor
        {...baseProps()}
        functions={[
          { id: 0, name: "main", isMain: true },
          { id: 1, name: "helper", isMain: false },
        ]}
        commandsByFunction={{ 0: commands, 1: commands }}
        layoutStore={{
          0: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
          1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
        }}
      />,
    );
    const f0 = view.container.querySelector(
      '#links path.edge[data-fid="0"][data-from="1"][data-to="2"]',
    );
    const f1 = view.container.querySelector(
      '#links path.edge[data-fid="1"][data-from="1"][data-to="2"]',
    );
    expect(f0).not.toBeNull();
    expect(f1).not.toBeNull();
    expect(f0).not.toBe(f1);
  });
});

describe("canvas geometry regression: join movement updates edges", () => {
  it("rerendering with a new join position moves the continuation edge", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: 5, condition: 2, then_body: [], else_body: [] },
      { id: 5, kind: "print", next: null, template: '"after"' },
    ];
    const layoutStore = {
      0: { 1: { x: IF_LOCAL_X, y: IF_LOCAL_Y }, 5: { x: CONT_BLOCK_LOCAL_X, y: CONT_BLOCK_LOCAL_Y } },
      1: { 1: { x: 48, y: 84 } },
    };
    const { container, rerender } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={layoutStore}
        mergeJoins={{ 1: { on: true, pos: { x: 200, y: 400 } } }}
      />,
    );
    const first = continuationEdge(container);
    expect(first).not.toBeNull();
    const dx1 =
      pathEndpoints(first?.getAttribute("d") ?? "").start.x -
      pathEndpoints(first?.getAttribute("d") ?? "").end.x;

    rerender(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={layoutStore}
        mergeJoins={{ 1: { on: true, pos: { x: 600, y: 900 } } }}
      />,
    );
    const second = continuationEdge(container);
    expect(second).not.toBeNull();
    const dx2 =
      pathEndpoints(second?.getAttribute("d") ?? "").start.x -
      pathEndpoints(second?.getAttribute("d") ?? "").end.x;

    // The join moved 400px right: the continuation edge's start moved with it.
    expect(dx2 - dx1).toBeCloseTo(400, 2);
  });
});

describe("canvas geometry regression: rendered flow glow with join", () => {
  it("travels the merge edge through the join and lights the join continuation", () => {
    const flow: FlowState = {
      runId: 1,
      edges: [
        { fid: 0, from: 1, to: 2, kind: "branch-head" },
        { fid: 0, from: 2, to: 5, kind: "merge" },
        { fid: 0, from: 2, to: 5, kind: "chain" },
      ],
      linkMs: 300,
    };
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: 5, condition: 2, then_body: [2], else_body: [] },
      { id: 2, kind: "print", next: null, template: '"a"' },
      { id: 5, kind: "print", next: null, template: '"after"' },
    ];
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={{ 0: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 300 }, 5: { x: 48, y: 700 } } }}
        mergeJoins={{ 1: { on: true, pos: null } }}
        flow={flow}
      />,
    );
    const dots = container.querySelectorAll("circle.flow-dot");
    // branch-head (1→2), merge tail rail (2→join), join continuation (jo:→5)
    expect(dots.length).toBeGreaterThanOrEqual(2);
    const mergeEdge = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="2"]',
    );
    expect(mergeEdge).not.toBeNull();
  });
});
