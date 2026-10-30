import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import VisualEditor from "../../components/VisualEditor";
import type { CommandSummary } from "../../lib/optilotus";
import type { UiCommand } from "../../lib/program";
import type { FlowState } from "../../lib/flow";

// jsdom does not implement document.elementsFromPoint; polyfill it so
// pointer-drop tests can steer which element is under the cursor.
(document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint =
  () => [];

const MAIN_COMMANDS: readonly CommandSummary[] = [
  { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
  { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
  { id: 3, kind: "print", next: null, template: '"{n}"' },
];

const HELPER_COMMANDS: readonly CommandSummary[] = [
  { id: 1, kind: "declare", next: 2, var: "m", ty: "int32", expr: "1" },
  { id: 2, kind: "return", next: null, expr: "{m}" },
];

function baseProps(): React.ComponentProps<typeof VisualEditor> {
  return {
    functions: [
      { id: 0, name: "main", isMain: true },
      { id: 1, name: "helper", isMain: false },
    ],
    commandsByFunction: { 0: MAIN_COMMANDS, 1: HELPER_COMMANDS },
    layoutStore: {
      0: {
        1: { x: 48, y: 84 },
        2: { x: 48, y: 240 },
        3: { x: 48, y: 396 },
      },
      1: {
        1: { x: 48, y: 84 },
        2: { x: 48, y: 240 },
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

describe("VisualEditor vertical If/Else", () => {
  const IF_BRANCH_COMMANDS: readonly UiCommand[] = [
    {
      id: 1,
      kind: "if",
      next: 5,
      planned: true,
      condition: 2,
      then_body: [2, 3, 10, 11],
      else_body: [],
    },
    { id: 2, kind: "print", next: 10, template: '"A"' },
    { id: 10, kind: "print", next: null, template: '"B"' },
    { id: 5, kind: "print", next: null, template: '"after"' },
  ];

  const IF_BRANCH_LAYOUT = {
    0: {
      1: { x: 48, y: 84 },
      2: { x: 48, y: 300 },
      10: { x: 48, y: 452 },
      5: { x: 48, y: 700 },
    },
    1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
  } as const;

  function pathNumbers(d: string): number[] {
    return [...d.matchAll(/[-\d.]+/g)].map((m) => Number(m[0]));
  }

  function describePointer(endpoint: Element | null, label: string): void {
    expect(endpoint, label).not.toBeNull();
  }

  function assertElementsFromPoint(elements: readonly (Element | null)[]): void {
    describePointer(elements[0], "drop target");
    (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint = () =>
      elements as Element[];
  }

  function dragWire(params: { container: HTMLElement; port: Element | null }): void {
    const { port, container } = params;
    expect(port).not.toBeNull();
    const board = container.querySelector("#board") as HTMLElement;
    fireEvent.pointerDown(port as Element, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerMove(board, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(board, { pointerId: 1, clientX: 10, clientY: 10 });
  }

  afterEach(() => {
    Object.defineProperty(document, "elementsFromPoint", {
      value: undefined,
      configurable: true,
    });
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  it("draws a TRUE and a FALSE body frame with the derived rects", () => {
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
      />,
    );
    const then = container.querySelector<HTMLDivElement>(
      '.vbranch[data-if-branch="then"][data-fid="0"]',
    );
    expect(then).not.toBeNull();
    expect(then?.getAttribute("data-if-id")).toBe("1");
    expect(then?.getAttribute("data-empty")).toBe("false");
    expect(then?.getAttribute("aria-hidden")).toBe("true");
    expect(then?.style.left).toBe("34px");
    expect(then?.style.top).toBe("278px");
    expect(then?.style.width).toBe("244px");
    expect(then?.style.height).toBe("300px");
    expect(then?.querySelector(".vbranch-tag")?.textContent).toBe("true");

    const elseFrame = container.querySelector<HTMLDivElement>(
      '.vbranch[data-if-branch="else"][data-fid="0"]',
    );
    expect(elseFrame?.getAttribute("data-empty")).toBe("true");
    expect(elseFrame?.querySelector(".vbranch-tag")?.textContent).toBe(
      "false · empty",
    );
    expect(elseFrame?.style.left).toBe("288px");
    expect(elseFrame?.style.top).toBe("228px");
    expect(elseFrame?.style.width).toBe("216px");
    expect(elseFrame?.style.height).toBe("76px");

    expect(container.querySelectorAll('.vbranch[data-fid="1"]').length).toBe(0);
  });

  it("shows the engine's condition text on the card, never the hidden id", () => {
    const { container, rerender } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
      />,
    );
    const card = container.querySelector(
      '.vblock[data-block-id="1"][data-fid="0"]',
    );
    expect(card?.querySelector(".vblock-main")?.textContent).toBe("if 2");
    rerender(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
        conditionTextFor={() => "n > 10"}
      />,
    );
    expect(
      container
        .querySelector('.vblock[data-block-id="1"][data-fid="0"]')
        ?.querySelector(".vblock-main")?.textContent,
    ).toBe("if n > 10");
  });

  it("anchors branch and body wires vertically, top to bottom", () => {
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
      />,
    );
    const branchEdge = container.querySelector(
      '#links path.edge[data-fid="0"][data-from="1"][data-to="2"]',
    );
    expect(branchEdge).not.toBeNull();
    expect(branchEdge?.classList.contains("edge-merge")).toBe(false);
    const branch = pathNumbers(branchEdge?.getAttribute("d") ?? "");
    expect((branch[3] ?? 0) - (branch[1] ?? 0)).toBeGreaterThan(0);
    expect(
      (branch[6] ?? 0) - (branch[0] ?? 0),
    ).toBeCloseTo(216 * (0.5 - 0.3), 5);

    const columnEdge = container.querySelector(
      '#links path.edge[data-fid="0"][data-from="2"][data-to="10"]',
    );
    expect(columnEdge).not.toBeNull();
    expect(columnEdge?.classList.contains("edge-merge")).toBe(false);
    const column = pathNumbers(columnEdge?.getAttribute("d") ?? "");
    expect(
      (column[6] ?? 0) - (column[0] ?? 0),
    ).toBeCloseTo(0, 5);
    expect((column[7] ?? 0) - (column[1] ?? 0)).toBeCloseTo(
      452 - (300 + 104),
      5,
    );
  });

  it("draws each branch's merge rail dashed into the if's successor — and no wire out of the card", () => {
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
      />,
    );
    const rail = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="10"][data-to="5"]',
    );
    expect(rail).not.toBeNull();
    expect(rail?.classList.contains("edge-planned")).toBe(false);
    const direct = container.querySelector(
      '#links path[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(direct).toBeNull();
    expect(
      container.querySelectorAll('#links path[data-from="9"]').length,
    ).toBe(0);
    expect(container.querySelectorAll(".vjoin").length).toBe(0);
  });

  it("sends a wire dropped on a body frame to that branch", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [9] },
      { id: 9, kind: "print", next: null, template: '"A"' },
      { id: 20, kind: "declare", next: null, var: "n", ty: "int32", expr: "41" },
    ];
    const layoutStore = {
      0: { 1: { x: 48, y: 84 }, 9: { x: 48, y: 300 }, 20: { x: 48, y: 700 } },
      1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
    } as const;
    const onReconnect = vi.fn(() => true);
    const onMoveBlock = vi.fn();
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={layoutStore}
        onReconnect={onReconnect}
        onMoveBlock={onMoveBlock}
      />,
    );
    assertElementsFromPoint([
      container.querySelector('.vbranch[data-if-branch="then"]'),
    ]);
    dragWire({
      container,
      port: container.querySelector(
        '.vport[data-fid="0"][data-block-id="20"][data-port="out"]',
      ),
    });
    expect(onReconnect).toHaveBeenCalledWith(0, 20, 1, "after", "then");
    expect(onMoveBlock).toHaveBeenCalledWith(0, 20, { x: 48, y: 428 });
  });

  it("sends a wire dropped on an empty body frame to that branch too", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [] },
      { id: 20, kind: "declare", next: null, var: "n", ty: "int32", expr: "41" },
    ];
    const layoutStore = {
      0: { 1: { x: 48, y: 84 }, 20: { x: 48, y: 700 } },
      1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
    } as const;
    const onReconnect = vi.fn(() => true);
    const onMoveBlock = vi.fn();
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={layoutStore}
        onReconnect={onReconnect}
        onMoveBlock={onMoveBlock}
      />,
    );
    assertElementsFromPoint([
      container.querySelector('.vbranch[data-if-branch="else"]'),
    ]);
    dragWire({
      container,
      port: container.querySelector(
        '.vport[data-fid="0"][data-block-id="20"][data-port="out"]',
      ),
    });
    expect(onReconnect).toHaveBeenCalledWith(0, 20, 1, "after", "else");
    expect(onMoveBlock).toHaveBeenCalledWith(0, 20, {
      x: 48 + 216 + 24,
      y: 84 + 104 + 40,
    });
  });

  it("wires a drop on a block from the if's branch port into that branch", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [] },
      { id: 9, kind: "print", next: null, template: '"A"' },
    ];
    const layoutStore = {
      0: { 1: { x: 48, y: 84 }, 9: { x: 48, y: 300 } },
      1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
    } as const;
    const onReconnect = vi.fn(() => true);
    const onMoveBlock = vi.fn();
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={layoutStore}
        onReconnect={onReconnect}
        onMoveBlock={onMoveBlock}
      />,
    );
    assertElementsFromPoint([
      container.querySelector('.vblock[data-fid="0"][data-block-id="9"]'),
    ]);
    dragWire({
      container,
      port: container.querySelector(
        '.vport[data-fid="0"][data-block-id="1"].vport-then',
      ),
    });
    expect(onReconnect).toHaveBeenCalledWith(0, 1, 9, "after", "then");
    expect(onMoveBlock).toHaveBeenCalledWith(0, 9, { x: 48, y: 228 });
  });

  it("keeps a rejected branch wiring out of the layout", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [] },
      { id: 20, kind: "declare", next: null, var: "n", ty: "int32", expr: "41" },
    ];
    const layoutStore = {
      0: { 1: { x: 48, y: 84 }, 20: { x: 48, y: 700 } },
      1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
    } as const;
    const onReconnect = vi.fn(() => false);
    const onMoveBlock = vi.fn();
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={layoutStore}
        onReconnect={onReconnect}
        onMoveBlock={onMoveBlock}
      />,
    );
    assertElementsFromPoint([
      container.querySelector('.vbranch[data-if-branch="then"]'),
    ]);
    dragWire({
      container,
      port: container.querySelector(
        '.vport[data-fid="0"][data-block-id="20"][data-port="out"]',
      ),
    });
    expect(onReconnect).toHaveBeenCalled();
    expect(onMoveBlock).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "The engine could not wire that connection.",
    );
  });

  it("refuses a wire onto a branch member with the reason, before any call", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [9] },
      { id: 9, kind: "print", next: null, template: '"A"' },
      { id: 20, kind: "declare", next: null, var: "n", ty: "int32", expr: "41" },
    ];
    const layoutStore = {
      0: { 1: { x: 48, y: 84 }, 9: { x: 48, y: 300 }, 20: { x: 48, y: 700 } },
      1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
    } as const;
    const onReconnect = vi.fn(() => true);
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={layoutStore}
        onReconnect={onReconnect}
      />,
    );
    assertElementsFromPoint([
      container.querySelector('.vblock[data-fid="0"][data-block-id="9"]'),
    ]);
    dragWire({
      container,
      port: container.querySelector(
        '.vport[data-fid="0"][data-block-id="20"][data-port="out"]',
      ),
    });
    expect(onReconnect).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "That block already runs inside an If/Else branch.",
    );
  });

  it("ports: member pair on branch bodies, three ports on the if card", () => {
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
      />,
    );
    const head = container.querySelector(
      '.vblock[data-block-id="2"][data-fid="0"]',
    );
    expect(head).not.toBeNull();
    const topIn = head?.querySelector(".vport.vport-top");
    expect(topIn).not.toBeNull();
    const columnOut = head?.querySelector(".vport.vport-out-bottom");
    expect(columnOut?.getAttribute("data-port")).toBe("out");
    expect(columnOut?.getAttribute("data-side")).toBe("bottom");
    expect(columnOut?.getAttribute("data-block-id")).toBe("2");
    const continuation = container.querySelector(
      '.vblock[data-block-id="5"][data-fid="0"]',
    );
    expect(continuation?.querySelector(".vport-top")).toBeNull();
    expect(continuation?.querySelector(".vport-out-bottom")).toBeNull();
    const card = container.querySelector(
      '.vblock[data-block-id="1"][data-fid="0"]',
    );
    expect(card?.querySelector(".vport.vport-left")).not.toBeNull();
    expect(card?.querySelector(".vport.vport-top")).toBeNull();
    expect(card?.querySelector(".vport.vport-right")).toBeNull();
    const thenPort = card?.querySelector(".vport.vport-bottom.vport-then");
    expect(thenPort?.getAttribute("data-port")).toBe("out");
    expect(thenPort?.getAttribute("data-side")).toBe("then");
    const elsePort = card?.querySelector(".vport.vport-bottom.vport-else");
    expect(elsePort?.getAttribute("data-side")).toBe("else");
  });

  it("renders the manual join circle once, under both frames, with its wires", () => {
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
        mergeJoins={{ 1: { on: true, pos: null } }}
      />,
    );
    const joins = container.querySelectorAll('.vjoin[data-join-of="1"]');
    expect(joins.length).toBe(1);
    const join = joins[0] as HTMLElement;
    expect(join.textContent).toContain("End of If Block");
    expect(join.querySelector(".vport.vport-top")).not.toBeNull();
    const out = join.querySelector(".vport.vport-right");
    expect(out?.getAttribute("data-port")).toBe("out");
    expect(out?.getAttribute("data-block-id")).toBe("1");
    expect(join.style.left).toBe("192px");
    expect(join.style.top).toBe("630px");
    const planned = container.querySelector(
      '#links path.edge-planned[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(planned).toBeNull();
    const jo = container.querySelector(
      '#links path[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(jo).not.toBeNull();
    expect(jo?.classList.contains("edge-planned")).toBe(false);
    expect(
      container.querySelector(
        '#links path.edge-merge[data-fid="0"][data-from="10"]',
      ),
    ).not.toBeNull();
    const emptyRail = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="1"][data-to="1"]',
    );
    expect(emptyRail).not.toBeNull();
    expect(joins.length).toBe(1);
  });

  it("feeds the join from the if card alone when both branches are empty", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [], else_body: [] },
    ];
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={{ 0: { 1: { x: 48, y: 84 } } }}
        mergeJoins={{ 1: { on: true, pos: null } }}
      />,
    );
    const rails = [
      ...container.querySelectorAll('#links path.edge-merge[data-fid="0"]'),
    ] as SVGElement[];
    expect(rails.length).toBe(2);
    const points = rails.map((p) => {
      const nums = [
        ...(p.getAttribute("d") ?? "").matchAll(/[-\d.]+/g),
      ].map((m) => Number(m[0]));
      return { x1: nums[0] ?? 0, y1: nums[1] ?? 0, x2: nums[6] ?? 0, y2: nums[7] ?? 0 };
    });
    expect(points[1]!.y1).toBeCloseTo(points[0]!.y1, 5);
    expect(points[1]!.x1 - points[0]!.x1).toBeCloseTo(216 * 0.4, 5);
    expect(points[1]!.x2).toBeCloseTo(points[0]!.x2, 5);
    expect(points[1]!.y2).toBeCloseTo(points[0]!.y2, 5);
  });

  it("joins off: classic rails end on the successor, with no join and no card wire", () => {
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
      />,
    );
    expect(container.querySelectorAll(".vjoin").length).toBe(0);
    expect(container.querySelectorAll(".vjoin-tag").length).toBe(0);
    const direct = container.querySelector(
      '#links path[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(direct).toBeNull();
    const rail = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="10"]',
    );
    expect(rail?.getAttribute("data-to")).toBe("5");
    expect(
      container.querySelector(
        '#links path[data-fid="0"][data-from="1"][data-to="2"]',
      ),
    ).not.toBeNull();
  });

  it("travels a merge edge through the join's tail rail and continuation", () => {
    const flow: FlowState = {
      runId: 1,
      edges: [
        { fid: 0, from: 1, to: 2, kind: "branch-head" },
        { fid: 0, from: 10, to: 5, kind: "merge" },
      ],
      linkMs: 300,
    };
    const withJoin = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
        mergeJoins={{ 1: { on: true, pos: null } }}
        flow={flow}
      />,
    );
    expect(
      withJoin.container.querySelectorAll(
        ".flow-travel circle.flow-dot",
      ).length,
    ).toBe(3);
    const withoutJoin = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
        flow={flow}
      />,
    );
    expect(
      withoutJoin.container.querySelectorAll(
        ".flow-travel circle.flow-dot",
      ).length,
    ).toBe(2);
  });

  it("previews a join-sourced wire from the join circle's own out port", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <VisualEditor
          {...baseProps()}
          commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
          layoutStore={IF_BRANCH_LAYOUT}
          mergeJoins={{ 1: { on: true, pos: { x: 200, y: 400 } } }}
        />,
      );
      const outPort = container.querySelector(
        '.vjoin[data-join-of="1"] .vport[data-port="out"]',
      );
      expect(outPort).not.toBeNull();
      const board = container.querySelector("#board") as HTMLElement;
      fireEvent.pointerDown(outPort as Element, {
        pointerId: 1,
        clientX: 10,
        clientY: 10,
        button: 0,
      });
      fireEvent.pointerMove(board, { pointerId: 1, clientX: 30, clientY: 20 });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      const ghost = container.querySelector("path.edge.edge-preview");
      expect(ghost).not.toBeNull();
      const jo = container.querySelector(
        '#links path[data-fid="0"][data-from="1"][data-to="5"]',
      );
      expect(jo).not.toBeNull();
      const joStart = pathNumbers(jo?.getAttribute("d") ?? "");
      const ghostStart = pathNumbers(
        (ghost as SVGElement).getAttribute("d") ?? "",
      );
      expect(ghostStart[0]).toBe(joStart[0]);
      expect(ghostStart[1]).toBe(joStart[1]);
      const branchWire = container.querySelector(
        '#links path[data-fid="0"][data-from="1"][data-to="2"]',
      );
      const branchStart = pathNumbers(branchWire?.getAttribute("d") ?? "");
      expect(ghostStart[0]).not.toBe(branchStart[0]);
      fireEvent.pointerUp(board, { pointerId: 1, clientX: 30, clientY: 20 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("wielding a join-source wire onto a block rewires the continuation", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: 5, condition: 2, then_body: [2], else_body: [] },
      { id: 2, kind: "print", next: null, template: '"A"' },
      { id: 5, kind: "print", next: null, template: '"after"' },
      { id: 7, kind: "print", next: null, template: '"new tail"' },
    ];
    const onReconnect = vi.fn(() => true);
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        layoutStore={{ 0: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 300 }, 5: { x: 48, y: 700 }, 7: { x: 48, y: 900 } } }}
        mergeJoins={{ 1: { on: true, pos: null } }}
        onReconnect={onReconnect}
      />,
    );
    assertElementsFromPoint([
      container.querySelector('.vblock[data-fid="0"][data-block-id="7"]'),
    ]);
    dragWire({
      container,
      port: container.querySelector(
        '.vjoin[data-join-of="1"] .vport[data-port="out"]',
      ),
    });
    expect(onReconnect).toHaveBeenCalledWith(0, 1, 7, "after", "right");
  });

  it("auto-places a newcomer that joined a branch off the canvas gestures", () => {
    const onMoveBlock = vi.fn();
    const { rerender } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: IF_BRANCH_COMMANDS, 1: HELPER_COMMANDS }}
        layoutStore={IF_BRANCH_LAYOUT}
        onMoveBlock={onMoveBlock}
      />,
    );
    expect(onMoveBlock).not.toHaveBeenCalled();
    rerender(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{
          0: [
            ...IF_BRANCH_COMMANDS.slice(0, 1).map((cmd) =>
              cmd.kind === "if"
                ? { ...cmd, then_body: [2, 3, 10, 11, 40, 41] }
                : cmd,
            ),
            IF_BRANCH_COMMANDS[1] as UiCommand,
            IF_BRANCH_COMMANDS[2] as UiCommand,
            IF_BRANCH_COMMANDS[3] as UiCommand,
            { id: 40, kind: "print", next: null, template: '"C"' },
          ],
          1: HELPER_COMMANDS,
        }}
        layoutStore={{
          ...IF_BRANCH_LAYOUT,
          0: { ...IF_BRANCH_LAYOUT[0], 40: { x: 48, y: 700 } },
        }}
        onMoveBlock={onMoveBlock}
      />,
    );
    expect(onMoveBlock).toHaveBeenCalledWith(0, 40, { x: 48, y: 580 });
  });
});
