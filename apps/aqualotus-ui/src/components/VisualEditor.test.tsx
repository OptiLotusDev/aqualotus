import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VisualEditor from "./VisualEditor";
import type { CommandSummary } from "../lib/optilotus";
import type { UiCommand } from "../lib/program";
import { EXIT_MS } from "../hooks/useExitItems";
import type { FlowState } from "../lib/flow";
import { JOIN_FALLBACK_SIZE, portCenter } from "../lib/graph";

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

describe("VisualEditor", () => {
  it("renders the package → struct → function hierarchy", () => {
    render(<VisualEditor {...baseProps()} />);
    expect(screen.getByLabelText("Package app")).toBeDefined();
    expect(screen.getByLabelText("Struct Main preview")).toBeDefined();
    expect(screen.getByLabelText("Function main")).toBeDefined();
    expect(screen.getByLabelText("Function helper")).toBeDefined();
  });

  it("renders one block per command with its semantic content", () => {
    render(<VisualEditor {...baseProps()} />);
    expect(screen.getByText("var: n")).toBeDefined();
    expect(screen.getAllByText("type: int32").length).toBe(2);
    expect(screen.getByText("value: 41")).toBeDefined();
    expect(screen.getByText("n = {n} + 1")).toBeDefined();
    expect(screen.getByText('"{n}"')).toBeDefined();
    expect(
      screen.getByRole("button", { name: /declare block 1 in main/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /declare block 1 in helper/ }),
    ).toBeDefined();
  });

  it("draws flow edges only — calls execute but draw no arrows", () => {
    const linked: React.ComponentProps<typeof VisualEditor> = {
      ...baseProps(),
      commandsByFunction: {
        0: [
          { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
          { id: 2, kind: "assign", next: null, var: "n", expr: "helper()" },
        ],
        1: HELPER_COMMANDS,
      },
    };
    const { container } = render(<VisualEditor {...linked} />);
    const flow = container.querySelectorAll(
      "#links path.edge:not(.edge-preview)",
    );
    expect(flow.length).toBe(2);
    for (const edge of flow) {
      expect(edge.getAttribute("d") ?? "").toMatch(/^M .* C .*$/);
    }
    // helper() still calls at runtime — it just draws nothing.
    expect(container.querySelectorAll("#links path.edge-call").length).toBe(0);
    expect(container.querySelectorAll("#links text").length).toBe(0);
  });

  it("selects blocks and flags the error block", async () => {
    const user = userEvent.setup();
    const onSelectCommand = vi.fn();
    render(
      <VisualEditor
        {...baseProps()}
        errorId={2}
        errorFunctionId={0}
        onSelectCommand={onSelectCommand}
      />,
    );
    expect(screen.getByText("Error reported here")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /assign block 2 in main/ }));
    expect(onSelectCommand).toHaveBeenCalledWith(2);
  });

  it("selects the function (not a foreign block) when clicking preview blocks", async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    const onSelectCommand = vi.fn();
    render(
      <VisualEditor
        {...baseProps()}
        onSelectFunction={onSelectFunction}
        onSelectCommand={onSelectCommand}
      />,
    );
    // helper's blocks are preview-only while main is selected: clicking
    // one must select helper without leaking its command id into main's
    // selection (ids collide across functions).
    await user.click(
      screen.getByRole("button", { name: /declare block 1 in helper/ }),
    );
    expect(onSelectFunction).toHaveBeenCalledWith(1);
    expect(onSelectCommand).not.toHaveBeenCalled();
  });

  it("selects the function when its container header is clicked", async () => {
    const user = userEvent.setup();
    const onSelectFunction = vi.fn();
    render(
      <VisualEditor {...baseProps()} onSelectFunction={onSelectFunction} />,
    );
    await user.click(screen.getByLabelText("Function helper"));
    expect(onSelectFunction).toHaveBeenCalledWith(1);
  });

  it("drags the package with its children on package background", () => {
    const { container } = render(<VisualEditor {...baseProps()} />);
    const pkgPos = container.querySelector(".pkg-pos") as HTMLElement;
    expect(pkgPos.style.left).toBe("20000px");
    const head = container.querySelector(".pkg-head") as HTMLElement;
    const board = container.querySelector("#board") as HTMLElement;
    fireEvent.pointerDown(head, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(board, { clientX: 220, clientY: 130 });
    fireEvent.pointerUp(board, { clientX: 220, clientY: 130 });
    // Whole subtree shifted right/down together.
    expect(pkgPos.style.left).toBe("20120px");
    expect(pkgPos.style.top).toBe("20030px");
  });

  it("pinch-zooms the canvas with two pointers, selecting nothing", async () => {    const onSelectCommand = vi.fn();
    render(<VisualEditor {...baseProps()} onSelectCommand={onSelectCommand} />);
    const board = screen.getByRole("toolbar").parentElement?.querySelector(
      "#board",
    ) as HTMLElement;
    expect(
      screen.getByRole("button", { name: /Zoom level 100 percent/ }),
    ).toBeDefined();
    // Two fingers down on empty canvas: second finger starts a pinch.
    fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerDown(board, { pointerId: 2, clientX: 200, clientY: 100, button: 0 });
    // Spread the fingers (100px → 200px apart): zoom doubles to the cap.
    fireEvent.pointerMove(board, { pointerId: 1, clientX: 0, clientY: 100 });
    await screen.findByRole("button", { name: /Zoom level 150 percent/ });
    fireEvent.pointerUp(board, { pointerId: 1, clientX: 0, clientY: 100 });
    fireEvent.pointerUp(board, { pointerId: 2, clientX: 200, clientY: 100 });
    // Canvas-only: no block selected or deselected by the gesture.
    expect(onSelectCommand).not.toHaveBeenCalled();
  });

  it("reset keeps the package in view instead of stranding the canvas", async () => {
    const user = userEvent.setup();
    const { container } = render(<VisualEditor {...baseProps()} />);
    const board = container.querySelector("#board") as HTMLElement;
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await screen.findByRole("button", { name: /Zoom level 110 percent/ });
    const before = board.scrollLeft;
    expect(before).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Activate to reset/ }));
    await screen.findByRole("button", { name: /Zoom level 100 percent/ });
    // Re-anchored on the package: scroll came back down, never negative.
    expect(board.scrollLeft).toBeGreaterThanOrEqual(0);
    expect(board.scrollLeft).toBeLessThan(before);
  });

  it("routes ctrl+wheel over the canvas to canvas zoom (page never zooms)", async () => {
    render(<VisualEditor {...baseProps()} />);
    const board = screen.getByRole("toolbar").parentElement?.querySelector(
      "#board",
    ) as HTMLElement;
    // fireEvent returns false when the event was default-prevented.
    const prevented = fireEvent.wheel(board, {
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 100,
      clientY: 100,
    });
    expect(prevented).toBe(false);
    await screen.findByRole("button", { name: /Zoom level 105 percent/ });
  });

  it("swallows ctrl+wheel outside the canvas without zooming anything", () => {
    render(<VisualEditor {...baseProps()} />);
    const toolbar = screen.getByRole("toolbar");
    const prevented = fireEvent.wheel(toolbar, {
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 10,
      clientY: 10,
    });
    // Swallowed (no page zoom) and the canvas zoom is untouched.
    expect(prevented).toBe(false);
    expect(
      screen.getByRole("button", { name: /Zoom level 100 percent/ }),
    ).toBeDefined();
  });

  it("maps ctrl+plus/minus with canvas focus to canvas zoom", async () => {
    const { container } = render(<VisualEditor {...baseProps()} />);
    const board = container.querySelector("#board") as HTMLElement;
    fireEvent.keyDown(board, { key: "+", ctrlKey: true });
    await screen.findByRole("button", { name: /Zoom level 105 percent/ });
    fireEvent.keyDown(board, { key: "-", ctrlKey: true });
    await screen.findByRole("button", { name: /Zoom level 100 percent/ });
  });

  it("shows the empty canvas with a path to the library", async () => {
    const user = userEvent.setup();
    const onRequestLibrary = vi.fn();
    render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: [], 1: [] }}
        layoutStore={{}}
        onRequestLibrary={onRequestLibrary}
      />,
    );
    // Per-function placeholders (the selected one links to the library).
    expect(screen.getAllByText("No blocks yet").length).toBe(2);
    await user.click(
      screen.getAllByRole("button", { name: "Open block library" })[0] as HTMLElement,
    );
    expect(onRequestLibrary).toHaveBeenCalledOnce();
  });

  it("positions do not affect semantic identity", () => {
    const moved = {
      0: {
        1: { x: 300, y: 300 },
        2: { x: 10, y: 400 },
        3: { x: 200, y: 500 },
      },
      1: {},
    };
    const { container } = render(
      <VisualEditor {...baseProps()} layoutStore={moved} />,
    );
    expect(screen.getByText("var: n")).toBeDefined();
    const block = container.querySelector('[data-block-id="1"]');
    expect(block?.getAttribute("style") ?? "").toContain("300px");
  });

  it("fades a deleted block out where it stood, then removes it", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<VisualEditor {...baseProps()} />);
      expect(container.querySelector('[data-exiting="true"]')).toBeNull();

      // The block left the model: it is gone from the program, but its
      // picture finishes its exit animation in place.
      rerender(
        <VisualEditor
          {...baseProps()}
          commandsByFunction={{
            0: [MAIN_COMMANDS[0], MAIN_COMMANDS[2]],
            1: HELPER_COMMANDS,
          }}
        />,
      );
      const ghost = container.querySelector('[data-exiting="true"]');
      expect(ghost).not.toBeNull();
      expect(ghost?.getAttribute("data-block-id")).toBe("2");
      // The ghost keeps the spot of the block it replaces.
      expect(ghost?.getAttribute("style") ?? "").toContain("240px");
      // It is inert: the model already dropped it.
      expect(ghost?.getAttribute("aria-hidden")).toBe("true");

      act(() => {
        vi.advanceTimersByTime(EXIT_MS + 50);
      });
      expect(container.querySelector('[data-exiting="true"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("travels the executed chain along its own connections", () => {
    const flow: FlowState = {
      runId: 1,
      edges: [
        { fid: 0, from: 1, to: 2, kind: "chain" },
        { fid: 0, from: 2, to: 3, kind: "chain" },
      ],
      linkMs: 300,
    };
    const { container } = render(<VisualEditor {...baseProps()} flow={flow} />);
    // One indicator per travelled connection: the head and its trail.
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(2);
    expect(container.querySelectorAll("circle.flow-trail").length).toBe(2);
    // The connections themselves stay exactly as they were.
    const edges = container.querySelectorAll("path.edge:not(.edge-preview)");
    expect(edges.length).toBe(3);
    for (const edge of edges) {
      expect(edge.getAttribute("stroke")).toBeNull();
      expect(edge.getAttribute("d")).toMatch(/^M .* C .*$/);
    }
  });

  it("restarts the travel on a new run instead of stacking loops", () => {
    const flow: FlowState = {
      runId: 1,
      edges: [{ fid: 0, from: 1, to: 2, kind: "chain" }],
      linkMs: 300,
    };
    const { container, rerender } = render(
      <VisualEditor {...baseProps()} flow={flow} />,
    );
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(1);
    rerender(<VisualEditor {...baseProps()} flow={{ ...flow, runId: 2 }} />);
    // A new run keeps exactly one indicator per connection.
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(1);
  });

  it("stretches a rewired connection into place", () => {
    const { container, rerender } = render(<VisualEditor {...baseProps()} />);
    expect(container.querySelectorAll("path.edge-draw").length).toBe(0);

    // The wire of command 1 now ends at command 3: it stretches into its
    // new place, arrowhead included.
    rerender(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{
          0: [
            { id: 1, kind: "declare", next: 3, var: "n", ty: "int32", expr: "41" },
            MAIN_COMMANDS[2],
          ],
          1: HELPER_COMMANDS,
        }}
      />,
    );
    expect(container.querySelectorAll("path.edge-draw").length).toBe(1);
    expect(container.querySelectorAll("path.edge-draw-head").length).toBe(1);
  });

  it("does not redraw a connection when a block only moves", () => {
    const { container, rerender } = render(<VisualEditor {...baseProps()} />);
    // The block moves, its wire keeps its destination: the wire follows
    // the block live instead of redrawing.
    rerender(
      <VisualEditor
        {...baseProps()}
        layoutStore={{
          0: {
            1: { x: 300, y: 300 },
            2: { x: 48, y: 240 },
            3: { x: 48, y: 396 },
          },
          1: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
        }}
      />,
    );
    expect(container.querySelectorAll("path.edge-draw").length).toBe(0);
  });

  it("paints the connection layer in front of the blocks", () => {
    const { container } = render(<VisualEditor {...baseProps()} />);
    const world = container.querySelector(".board-world");
    expect(world).not.toBeNull();
    const children = [...(world?.children ?? [])];
    const links = children.findIndex((c) => c.id === "links");
    const pkg = children.findIndex((c) => c.classList.contains("pkg-pos"));
    expect(pkg).toBeGreaterThanOrEqual(0);
    expect(links).toBeGreaterThan(pkg);
  });

  it("gives every block a port on both edges", () => {
    const { container } = render(<VisualEditor {...baseProps()} />);
    const blocks = container.querySelectorAll(".vblock");
    expect(blocks.length).toBe(5);
    for (const block of blocks) {
      // The ports are the connection targets: one per edge.
      expect(block.querySelectorAll(".vport-left").length).toBe(1);
      expect(block.querySelectorAll(".vport-right").length).toBe(1);
    }
  });
});

/**
 * Casting is an option of the Assign Variable block, so the canvas
 * annotates that same block instead of drawing a second node or edge.
 */
describe("VisualEditor casting annotation", () => {
  const CAST_COMMANDS: readonly UiCommand[] = [
    { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "7" },
    {
      id: 2,
      kind: "assign",
      next: 3,
      var: "f",
      ty: "float64",
      expr: "{n}",
      casting: {
        anchorId: 4,
        castId: 5,
        tempName: "__aqualotus_internal_cast_1",
        destinationName: "f",
        sourceExpr: "{n}",
        targetType: "float64",
      },
    },
    { id: 3, kind: "print", next: null, template: '"{f}"' },
  ];

  function castingProps(): React.ComponentProps<typeof VisualEditor> {
    return {
      ...baseProps(),
      commandsByFunction: { 0: CAST_COMMANDS, 1: HELPER_COMMANDS },
    };
  }

  it("shows the exact annotation inside the casting assign only", () => {
    render(<VisualEditor {...castingProps()} />);
    const annotation = screen.getByTestId("casting-enabled-2");
    expect(annotation.textContent?.trim()).toBe(
      "Casting Enabledtype: float64",
    );
    expect(annotation.className).toBe("vblock-casting");
    // Below the label line: the converted type.
    const typeLine = screen.getByTestId("casting-target-type-2");
    expect(typeLine.textContent).toBe("type: float64");
    const assign = screen.getByRole("button", {
      name: /assign block 2 in main/,
    });
    expect(assign.contains(annotation)).toBe(true);
    expect(annotation.contains(typeLine)).toBe(true);
    expect(screen.getAllByText("Casting Enabled")).toHaveLength(1);
    // No annotation without a conversion group.
    expect(screen.queryByTestId("casting-enabled-1")).toBeNull();
    expect(screen.queryByTestId("casting-enabled-3")).toBeNull();
  });

  it("attaches a decorative inverted-L connector to the block top", () => {
    const { container } = render(<VisualEditor {...castingProps()} />);
    const annotation = screen.getByTestId("casting-enabled-2");
    const connector = screen.getByTestId("casting-connector-2");
    const assign = screen.getByRole("button", {
      name: /assign block 2 in main/,
    });
    // The plate and its connector are children of the same visible
    // assignment, keyed by its stable Engine id, so they inherit every
    // drag/pan/zoom transform without separate coordinates.
    expect(assign.contains(annotation)).toBe(true);
    expect(annotation.contains(connector)).toBe(true);
    expect(connector.getAttribute("aria-hidden")).toBe("true");
    expect(annotation.getAttribute("data-casting-assignment")).toBe("2");
    expect(annotation.getAttribute("data-casting-target")).toBe("float64");
    // Decorative only: no extra SVG edge/endpoint is added.
    const edgeEndpoints = new Set(
      [...container.querySelectorAll('#links path.edge[data-fid="0"]')].flatMap(
        (edge) => [edge.getAttribute("data-from"), edge.getAttribute("data-to")],
      ),
    );
    expect(edgeEndpoints).toEqual(new Set(["1", "2", "3"]));
  });

  it("annotates a cross-type conversion and hides only broken ones", () => {
    const casting: UiCommand["casting"] = {
      anchorId: 4,
      castId: 5,
      tempName: "__aqualotus_internal_cast_1",
      destinationName: "f",
      sourceExpr: "{n}",
      targetType: "int32",
    };
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "7" },
      {
        id: 2,
        kind: "assign",
        next: null,
        var: "f",
        ty: "int64",
        expr: "{n}",
        casting,
      },
    ];
    { // A target that differs from the destination is valid — the store
      // leg converts into the declared type, and the annotation names
      // the target (with its type line below the label).
      const view = render(
        <VisualEditor
          {...baseProps()}
          commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
        />,
      );
      const annotation = screen.getByTestId("casting-enabled-2");
      expect(annotation.getAttribute("data-casting-target")).toBe("int32");
      // The type line names the chosen target, not the destination type.
      expect(screen.getByTestId("casting-target-type-2").textContent).toBe(
        "type: int32",
      );
      // Only this assign carries it.
      expect(
        view.container.querySelectorAll('[data-testid^="casting-enabled-"]'),
      ).toHaveLength(1);
      view.unmount();
    }

    // Broken shapes stay hidden: illegal target and unresolved type.
    const illegal: UiCommand[] = [
      {
        id: 2,
        kind: "assign",
        next: null,
        var: "f",
        ty: "int32",
        expr: "{n}",
        casting: { ...casting, targetType: "void" as never },
      },
    ];
    const noType: UiCommand[] = [
      {
        id: 2,
        kind: "assign",
        next: null,
        var: "f",
        expr: "{n}",
        casting,
      },
    ];
    for (const broken of [illegal, noType]) {
      const view = render(
        <VisualEditor
          {...baseProps()}
          commandsByFunction={{ 0: broken, 1: HELPER_COMMANDS }}
        />,
      );
      expect(screen.queryByTestId("casting-enabled-2")).toBeNull();
      view.unmount();
    }
  });

  it("adds no flow edge: the conversion stays inside the block", () => {
    const { container } = render(<VisualEditor {...castingProps()} />);
    const edges = container.querySelectorAll(
      '#links path.edge[data-fid="0"]',
    );
    expect(edges.length).toBe(2);
    expect(
      [...edges].map((edge) => [
        edge.getAttribute("data-from"),
        edge.getAttribute("data-to"),
      ]),
    ).toEqual([
      ["1", "2"],
      ["2", "3"],
    ]);
  });
});

/**
 * The `if` gap: the engine cannot report the edge into an `if` (its
 * hidden condition compute sits between the blocks), so the UI marks
 * that connection as *planned* and draws it apart from the confirmed
 * ones.
 */
describe("VisualEditor `if` connections", () => {
  it("draws the planned connection into an `if` apart from the confirmed ones", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "print", next: 2, planned: true, template: '"A"' },
      { id: 2, kind: "if", next: null, condition: 3 },
    ];
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
      />,
    );
    const edges = container.querySelectorAll('#links path.edge[data-fid="0"]');
    expect(edges.length).toBe(1);
    expect(edges[0]?.getAttribute("data-from")).toBe("1");
    expect(edges[0]?.getAttribute("data-to")).toBe("2");
    // Planned connections are dashed: a viewer can tell them apart
    // from the connections the engine confirms itself.
    expect(edges[0]?.classList.contains("edge-planned")).toBe(true);
  });

  it("anchors the branch wire at the branch's first visible block", () => {
    // The engine's branch list starts at the branch's first raw node,
    // which is a hidden node here: the wire must start at the visible
    // block instead.
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [2, 3, 4] },
      { id: 4, kind: "print", next: null, template: '"in branch"' },
    ];
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
      />,
    );
    const edges = container.querySelectorAll('#links path.edge[data-fid="0"]');
    expect(edges.length).toBe(1);
    expect(edges[0]?.getAttribute("data-from")).toBe("1");
    expect(edges[0]?.getAttribute("data-to")).toBe("4");
  });

  it("draws no edge twice when a branch member is also chained", () => {
    const commands: readonly UiCommand[] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [2, 3] },
      { id: 4, kind: "print", next: null, template: '"in branch"' },
    ];
    const { container } = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
      />,
    );
    const edges = [
      ...container.querySelectorAll('#links path.edge[data-fid="0"]'),
    ].map(
      (edge) =>
        `${edge.getAttribute("data-from")}>${edge.getAttribute("data-to")}`,
    );
    expect(new Set(edges).size).toBe(edges.length);
  });
});

describe("VisualEditor vertical If/Else", () => {
  /**
   * One `if` with two prints in its TRUE body — print A chains print B
   * (the engine reports the member `next` link) — and one print after
   * the if. The branch list carries every raw id: 3 and 11 are the
   * prints' hidden tails, so only ids 2 and 10 stay visible members.
   * The if's own `next` is the staged continuation (planned: the engine
   * cannot report a user-level pointer out of an `if`).
   */
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

  /** jsdom implements no geometry: give the wire gesture exactly the
   * DOM nodes a real browser would list under the drop point. */
  function assertElementsFromPoint(elements: readonly (Element | null)[]): void {
    describePointer(elements[0], "drop target");    Object.defineProperty(document, "elementsFromPoint", {
      value: () => elements as Element[],
      configurable: true,
      writable: true,
    });
  }

  /** One full connection gesture: grab the out-port, stretch the wire,
   * release it over the board (drop hit comes from the stub above). */
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
    // jsdom has no elementsFromPoint implementation — put back whatever
    // the base environment offered after every gesture test.
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
    // Fallback sizes (no measured layout in jsdom) are 216×104.
    const then = container.querySelector<HTMLDivElement>(
      '.vbranch[data-if-branch="then"][data-fid="0"]',
    );
    expect(then).not.toBeNull();
    expect(then?.getAttribute("data-if-id")).toBe("1");
    expect(then?.getAttribute("data-empty")).toBe("false");
    // Decorative: never focusable, never announced.
    expect(then?.getAttribute("aria-hidden")).toBe("true");
    // Union of both members' rects plus the frame padding.
    expect(then?.style.left).toBe("34px");
    expect(then?.style.top).toBe("278px");
    expect(then?.style.width).toBe("244px");
    expect(then?.style.height).toBe("300px");
    expect(then?.querySelector(".vbranch-tag")?.textContent).toBe("true");

    const elseFrame = container.querySelector<HTMLDivElement>(
      '.vbranch[data-if-branch="else"][data-fid="0"]',
    );
    // The engine reports no FALSE body: the frame is the faint
    // placeholder that keeps the branch's drop target visible.
    expect(elseFrame?.getAttribute("data-empty")).toBe("true");
    expect(elseFrame?.querySelector(".vbranch-tag")?.textContent).toBe(
      "false · empty",
    );
    // Ghost frame beside the if card FALSE lane: strictly right of the
    // if and below its bottom.
    expect(elseFrame?.style.left).toBe("288px");
    expect(elseFrame?.style.top).toBe("228px");
    expect(elseFrame?.style.width).toBe("216px");
    expect(elseFrame?.style.height).toBe("76px");

    // The other function has no `if`: no frames may leak across.
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
    // No probe yet: the honest fallback (the summary cannot turn the
    // hidden condition value into text, so nothing is invented).
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
    // TRUE wire: the if's bottom 30% port down into the head's top edge.
    const branchEdge = container.querySelector(
      '#links path.edge[data-fid="0"][data-from="1"][data-to="2"]',
    );
    expect(branchEdge).not.toBeNull();
    expect(branchEdge?.classList.contains("edge-merge")).toBe(false);
    const branch = pathNumbers(branchEdge?.getAttribute("d") ?? "");
    // Downward, and offset exactly by the (50% − 30%) port fraction.
    expect((branch[3] ?? 0) - (branch[1] ?? 0)).toBeGreaterThan(0);
    expect(
      (branch[6] ?? 0) - (branch[0] ?? 0),
    ).toBeCloseTo(216 * (0.5 - 0.3), 5);

    // Body column: print A's bottom runs straight into print B's top.
    const columnEdge = container.querySelector(
      '#links path.edge[data-fid="0"][data-from="2"][data-to="10"]',
    );
    expect(columnEdge).not.toBeNull();
    expect(columnEdge?.classList.contains("edge-merge")).toBe(false);
    const column = pathNumbers(columnEdge?.getAttribute("d") ?? "");
    expect(
      (column[6] ?? 0) - (column[0] ?? 0),
    ).toBeCloseTo(0, 5);
    // Autumn heading down… one body height of descent.
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
    // The TRUE body's tail runs back into the print after the if.
    const rail = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="10"][data-to="5"]',
    );
    expect(rail).not.toBeNull();
    expect(rail?.classList.contains("edge-planned")).toBe(false);
    // The if card carries no right out-port, so **no** wire leaves the
    // card directly — not even the planned continuation pointer the
    // engine cannot report. The card's output exists only through its
    // branch tails (and — with the join on — the join circle's own
    // wire): one drawn truth per connection, never a phantom port.
    const direct = container.querySelector(
      '#links path[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(direct).toBeNull();
    // No rail for the empty FALSE branch, and no join circle either
    // (merge off — the empty placeholder frame stays bare).
    expect(
      container.querySelectorAll('#links path[data-from="9"]').length,
    ).toBe(0);
    expect(container.querySelectorAll(".vjoin").length).toBe(0);
  });

  it("sends a wire dropped on a body frame to that branch", () => {
    // A declare block on the main chain; the TRUE body holds one print.
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
    // The engine wired it, so the newcomer takes the body column spot
    // below the branch's last member (fallback height 104 + stack gap).
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
    // The empty placeholder's ghost rect IS the branch's drop column:
    // FALSE sits strictly right of the if, below its bottom.
    expect(onMoveBlock).toHaveBeenCalledWith(0, 20, {
      x: 48 + 216 + 24,
      y: 84 + 104 + 40,
    });
  });

  it("wires a drop on a block from the if's branch port into that branch", () => {
    // The drop target runs OUTSIDE the branch (the if's body has no
    // members yet): a wire from the TRUE port onto an existing member
    // is refused before any bridge call, but an outside block joins
    // through `onReconnect` and takes its body column spot.
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
    // Dropping onto a block body (not a frame) wires it right after…
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
    // The empty TRUE column anchors its first member at the placeholder
    // under the `if` card (if height 104 + pad 40).
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
    // The engine refused the wiring (and the refusal surfaces honestly)
    // — so no ghost spot may leak into the layout store.
    expect(onReconnect).toHaveBeenCalled();
    expect(onMoveBlock).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "The engine could not wire that connection.",
    );
  });

  it("refuses a wire onto a branch member with the reason, before any call", () => {
    // A drop on a member would give it two predecessors: the resolver
    // answers before any bridge call, and the canvas explains itself.
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
    // A branch member carries the vertical pair: the branch enters its
    // top port and the column flow leaves its bottom port.
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
    // A non-member keeps only the classic side pair — no portal pair
    // leaks onto blocks the engine runs from the chain.
    const continuation = container.querySelector(
      '.vblock[data-block-id="5"][data-fid="0"]',
    );
    expect(continuation?.querySelector(".vport-top")).toBeNull();
    expect(continuation?.querySelector(".vport-out-bottom")).toBeNull();
    // The `if` card carries exactly three ports: a LEFT in-port (the
    // chain feeding the decision reads like every other block), and
    // the 30%/70% TRUE/FALSE pair on its bottom edge. No top in-port,
    // and no right continuation out — the card's output exists only
    // through its branch tails and the join circle, never stray ports.
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
    // One pill per `if`, holding the join tag and both ports.
    const joins = container.querySelectorAll('.vjoin[data-join-of="1"]');
    expect(joins.length).toBe(1);
    const join = joins[0] as HTMLElement;
    expect(join.textContent).toContain("End of If Block");
    expect(join.querySelector(".vport.vport-top")).not.toBeNull();
    const out = join.querySelector(".vport.vport-right");
    expect(out?.getAttribute("data-port")).toBe("out");
    expect(out?.getAttribute("data-block-id")).toBe("1");
    // Auto spot below both frames, centred between the columns:
    // then frame (34,278,244,300) centre x 156 and else ghost
    // (288,228,216,76) centre x 396 → mean 276 − 84 = 192;
    // y clears the lowest frame bottom (578) by JOIN_GAP (52).
    expect(join.style.left).toBe("192px");
    expect(join.style.top).toBe("630px");
    // The `if`'s own continuation edge is gone: flow addresses the join
    // circle, one drawn truth per connection.
    const planned = container.querySelector(
      '#links path.edge-planned[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(planned).toBeNull();
    // The continuation wire still exists — out of the join's right port
    // (unplanned: drawn, not a broken engine pointer).
    const jo = container.querySelector(
      '#links path[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(jo).not.toBeNull();
    expect(jo?.classList.contains("edge-planned")).toBe(false);
    // Both incoming arrows address the circle: the TRUE body's tail
    // rail leaves the column's bottom port…
    expect(
      container.querySelector(
        '#links path.edge-merge[data-fid="0"][data-from="10"]',
      ),
    ).not.toBeNull();
    // …and the empty FALSE branch — no member at all — still feeds the
    // circle through the if card's own FALSE port (one rail per
    // TRUE/FALSE branch, continuation or not).
    const emptyRail = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="1"][data-to="1"]',
    );
    expect(emptyRail).not.toBeNull();
    expect(joins.length).toBe(1);
  });

  it("feeds the join from the if card alone when both branches are empty", () => {
    // Even with no body member at all — and no continuation to rejoin
    // (`next: null`) — the merge circle draws with one incoming rail
    // per TRUE/FALSE port, straight off the card's own branch ports.
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
    // No continuation → no join→continuation wire; just the two feeds.
    expect(rails.length).toBe(2);
    const points = rails.map((p) => {
      const nums = [
        ...(p.getAttribute("d") ?? "").matchAll(/[-\d.]+/g),
      ].map((m) => Number(m[0]));
      return { x1: nums[0] ?? 0, y1: nums[1] ?? 0, x2: nums[6] ?? 0, y2: nums[7] ?? 0 };
    });
    // Both rails leave the same bottom edge of the card (the card's
    // fallback width 216: TRUE at 30%, FALSE at 70% → 0.4 width apart)…
    expect(points[1]!.y1).toBeCloseTo(points[0]!.y1, 5);
    expect(points[1]!.x1 - points[0]!.x1).toBeCloseTo(216 * 0.4, 5);
    // …and land together on the join circle's top-in port.
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
    // The if card carries no right out-port: no drawn continuation wire
    // straight off the card, planned or otherwise.
    const direct = container.querySelector(
      '#links path[data-fid="0"][data-from="1"][data-to="5"]',
    );
    expect(direct).toBeNull();
    // The classic picture carries the continuation through the branch
    // tail's rail running straight into the block after the if...
    const rail = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="10"]',
    );
    expect(rail?.getAttribute("data-to")).toBe("5");
    // ...while the branch wire still enters the TRUE body's head.
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
    // With merge on, the engine merge expands into two physical wires
    // (tail → join, join → continuation): two indicators for it, plus
    // the decided branch-head — three in total, no duplicated segment.
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
    // Merge off: the same merge edge travels the direct tail rail only.
    expect(
      withoutJoin.container.querySelectorAll(
        ".flow-travel circle.flow-dot",
      ).length,
    ).toBe(2);
  });

  it("previews a join-sourced wire from the join circle's own out port", () => {
    // A drag from the join pill's right port starts its ghost where the
    // persisted continuation wire starts — the circle's right port —
    // never at the `if` card the pill names (the card has no right
    // port to leave from).
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
      // Stretch the wire (pointer moves on the board; the ghost rides
      // it through one rAF frame).
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
      // The join's own continuation wire leaves the identical point…
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
      // …and it is NOT anchored anywhere on the `if` card itself: the
      // card's anchors are its bottom TRUE/FALSE ports (the branch
      // wire) and its left in-port — whose x differs from the join
      // circle's stored spot (200 → its right port at +168).
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
    // The drop resolves through the ordinary planners with the wire's
    // source = the `if` (the pill names it), so persisting a wire from
    // the join circle sets the engine's own `if.next` — the drawn
    // continuation afterwards leaves the circle (the jo wire), not the
    // card.
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
    // Membership changed while no canvas gesture produced it (e.g. an
    // undo replay): the diff effect gives the newcomer its body column
    // spot — presentation only, engine membership untouched.
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
    // The newcomer sits below the branch's last member (452 + 104 + 24).
    expect(onMoveBlock).toHaveBeenCalledWith(0, 40, { x: 48, y: 580 });
  });
});

describe("VisualEditor port-centred edges (§6)", () => {
  /**
   * The §6 port invariant: every drawn connection starts on and lands
   * on the centre of a port circle the DOM really carries — never on a
   * bare block border. The validator reads each block/join pill's own
   * canvas position, builds the port-circle set that DOM node actually
   * renders (the same roles `portCenter` names), and checks every
   * Bézier's first and last coordinates against it.
   *
   * Sizes are the component's fallbacks: no measurement ever runs
   * (jsdom has no ResizeObserver), so the edges memo renders with
   * exactly these. 216×104 mirrors `FALLBACK_SIZE` in VisualEditor.tsx;
   * the pill's size is `JOIN_FALLBACK_SIZE` from the graph module.
   */
  const BLOCK_W = 216;
  const BLOCK_H = 104;

  /** The plain chain: two side-port wires (out-right → in-left). */
  const CHAIN: readonly UiCommand[] = [
    { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
    { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
    { id: 3, kind: "print", next: null, template: '"n"' },
  ];

  /**
   * An `if` with a populated TRUE body (its head chains a second
   * member — the hidden tail ids stay in the list, engine truth) and
   * one print after the `if`; the if's pointer is the planned overlay
   * the engine cannot report. FALSE stays empty.
   */
  const IF_BODY: readonly UiCommand[] = [
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

  /** The join-on doppelganger: same bodies, merge circle displayed. */
  const JOIN_STATE: Readonly<Record<number, { on: boolean; pos: null }>> = {
    1: { on: true, pos: null },
  };

  const IF_BODY_LAYOUT = {
    0: {
      1: { x: 48, y: 84 },
      2: { x: 48, y: 300 },
      10: { x: 48, y: 452 },
      5: { x: 48, y: 700 },
    },
  } as const;

  /** One block per function: no chain edge, so every drawn wire below
   * belongs to the tested function's port circles. */
  const LONELY_HELPER: readonly UiCommand[] = [
    { id: 1, kind: "declare", next: null, var: "m", ty: "int32", expr: "1" },
  ];

  function px(styleValue: string): number {
    return Number(styleValue.replace("px", ""));
  }

  /** Every port-circle centre one function's DOM carries (relative to
   * the function's own origin — the delta-based space the existing
   * wire-geometry tests use): the roles the block/pill really renders —
   * a block carries its left in-port, an `if` card its bottom
   * TRUE/FALSE pair, an ordinary chain block its right out-port, a
   * branch member the vertical pair, and a join pill its in-top /
   * out-right ports. */
  function portCentres(root: Element): {
    centre: { x: number; y: number };
    label: string;
  }[] {
    const out: { centre: { x: number; y: number }; label: string }[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(".vblock"))) {
      const rect = {
        x: px(el.style.left),
        y: px(el.style.top),
        w: BLOCK_W,
        h: BLOCK_H,
      };
      const id = el.getAttribute("data-block-id");
      out.push({
        centre: portCenter(rect, "inLeft"),
        label: `block ${id} in-left`,
      });
      if (el.getAttribute("data-kind") === "if") {
        out.push({
          centre: portCenter(rect, "then"),
          label: `block ${id} true port`,
        });
        out.push({
          centre: portCenter(rect, "else"),
          label: `block ${id} false port`,
        });
      } else {
        out.push({
          centre: portCenter(rect, "outRight"),
          label: `block ${id} out-right`,
        });
        if (el.querySelector(".vport-out-bottom") !== null) {
          out.push({
            centre: portCenter(rect, "inTop"),
            label: `block ${id} body-in`,
          });
          out.push({
            centre: portCenter(rect, "outBottom"),
            label: `block ${id} body-out`,
          });
        }
      }
    }
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>(".vjoin"),
    )) {
      const rect = {
        x: px(el.style.left),
        y: px(el.style.top),
        w: JOIN_FALLBACK_SIZE.w,
        h: JOIN_FALLBACK_SIZE.h,
      };
      out.push({
        centre: portCenter(rect, "joinIn"),
        label: `join ${el.getAttribute("data-join-of")} in-top`,
      });
      out.push({
        centre: portCenter(rect, "joinOut"),
        label: `join ${el.getAttribute("data-join-of")} out-right`,
      });
    }
    return out;
  }

  /** The first and the last coordinate pair of one path. */
  function pathEndpoints(d: string): {
    start: { x: number; y: number };
    end: { x: number; y: number };
  } {
    const nums = [...d.matchAll(/[-\d.]+/g)].map((m) => Number(m[0]));
    return {
      start: { x: nums[0] ?? NaN, y: nums[1] ?? NaN },
      end: {
        x: nums[nums.length - 2] ?? NaN,
        y: nums[nums.length - 1] ?? NaN,
      },
    };
  }

  /** A wired source→target pair this state must show (so a broken
   * canvas that simply draws nothing fails loudly here, not silently). */
  function requireEdge(
    root: Element,
    fid: number,
    from: number,
    to: number,
    merge: boolean,
  ): void {
    const el = root.querySelector(
      `#links path.edge[data-fid="${fid}"][data-from="${from}"][data-to="${to}"]${
        merge ? ".edge-merge" : ":not(.edge-merge)"
      }`,
    );
    expect(el, `${from}→${to} (${merge ? "merge" : "flow"}) not drawn`)
      .not.toBeNull();
  }

  /**
   * The §6 port invariant, whole-canvas form: the edges' SVG paths are
   * painted in **world** coordinates while the port circles sit at
   * function-relative positions, and the conversion between the two is
   * one shared offset the whole canvas owns (the drawn pkg's spot). The
   * validator solves that offset once per drawn function — every
   * endpoint-edge/centre pairing votes for the same shift — and then
   * demands every first/last coordinate of every drawn connection equal
   * a port-circle centre that DOM node really carries, at that shared
   * offset. No per-anchor exceptions: a wire anchored on a border, a
   * wrong port fraction, a shifted pill, a missing role — anything but
   * the ports leaves an unmatched endpoint.
   */
  function assertEdgesOnPorts(container: HTMLElement): void {
    const Eps = 0.25;
    const problems: string[] = [];
    const byFid = new Map<number, string[]>();
    for (const path of Array.from(
      container.querySelectorAll(
        "#links path.edge:not(.edge-draw-head):not(.edge-preview)",
      ),
    )) {
      const fid = Number(path.getAttribute("data-fid"));
      const list = byFid.get(fid) ?? [];
      list.push(path.getAttribute("d") ?? "");
      byFid.set(fid, list);
    }
    for (const [fid, ds] of byFid) {
      const centres = portCentres(container);
      const endpoints = ds.flatMap((d) => {
        const { start, end } = pathEndpoints(d);
        return [start, end];
      });
      // One offset per function, solved from all endpoint/centre pairs
      // at once: a candidate counts only when it lands *every* drawn
      // endpoint on some centre.
      const first = endpoints[0];
      if (first === undefined) continue;
      let offset: { x: number; y: number } | null = null;
      for (const c of centres) {
        const cand = { x: first.x - c.centre.x, y: first.y - c.centre.y };
        const allMatch = endpoints.every((point) =>
          centres.some(
            (c2) =>
              Math.abs(c2.centre.x + cand.x - point.x) < Eps &&
              Math.abs(c2.centre.y + cand.y - point.y) < Eps,
          ),
        );
        if (allMatch) {
          offset = cand;
          break;
        }
      }
      if (offset === null) {
        const off = centres[0]?.centre ?? { x: NaN, y: NaN };
        const guess = `${first.x - off.x}, ${first.y - off.y}`;
        problems.push(
          `fid ${fid}: no single canvas offset places all ${endpoints.length} drawn endpoints on port circles; seen relative centres [${centres
            .map((c) => `(${c.centre.x}, ${c.centre.y}) ${c.label}`)
            .join("; ")}]; endpoints [${endpoints.map(
            (p) => `(${p.x}, ${p.y})`,
          ).join("; ")}] (offset probe starts near ${guess})`,
        );
        continue;
      }
      // (Solved: every endpoint is a port centre at this offset.)
    }
    expect(problems).toEqual([]);
  }

  function renderState(
    commands: readonly UiCommand[],
    layout: Readonly<Record<number, Record<number, { x: number; y: number }>>>,
    mergeJoins?: Readonly<Record<number, { on: boolean; pos: null }>>,
  ): HTMLElement {
    const view = render(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: commands, 1: LONELY_HELPER }}
        layoutStore={layout}
        mergeJoins={mergeJoins}
      />,
    );
    return view.container;
  }

  const CHAIN_LAYOUT = {
    0: {
      1: { x: 48, y: 84 },
      2: { x: 48, y: 240 },
      3: { x: 48, y: 396 },
    },
    1: { 1: { x: 48, y: 84 } },
  } as const;

  it("anchors a plain chain on the side ports only", () => {
    const container = renderState(CHAIN, CHAIN_LAYOUT);
    requireEdge(container, 0, 1, 2, false);
    requireEdge(container, 0, 2, 3, false);
    assertEdgesOnPorts(container);
  });

  it("anchors branch, body and classic-merge wires on their port circles", () => {
    const container = renderState(IF_BODY, IF_BODY_LAYOUT);
    // The branch wire leaves the card's TRUE port; the column link runs
    // body-head → member; the classic rail runs the tail into the block
    // after the `if`; and no wire ever leaves the card directly (the
    // card carries no right port — the planned pointer is suppressed).
    requireEdge(container, 0, 1, 2, false);
    requireEdge(container, 0, 2, 10, false);
    requireEdge(container, 0, 10, 5, true);
    expect(
      container.querySelectorAll(
        '#links path.edge[data-fid="0"][data-from="1"][data-to="5"]',
      ).length,
    ).toBe(0);
    assertEdgesOnPorts(container);
  });

  it("anchors the join-mode rails and the circle's continuation on their ports", () => {
    const container = renderState(IF_BODY, IF_BODY_LAYOUT, JOIN_STATE);
    // One rail per branch: the populated tail's rail leaves the member's
    // bottom port; the empty FALSE branch feeds the circle straight from
    // the card's own FALSE port. The continuation leaves the circle.
    const tailRail = container.querySelector(
      '#links path.edge-merge[data-fid="0"][data-from="10"]',
    );
    expect(tailRail).not.toBeNull();
    expect(tailRail?.getAttribute("data-to")).toBe("1");
    expect(
      container.querySelector(
        '#links path.edge-merge[data-fid="0"][data-from="1"][data-to="1"]',
      ),
    ).not.toBeNull();
    requireEdge(container, 0, 1, 5, true);
    expect(
      container.querySelectorAll(
        '#links path.edge[data-fid="0"][data-from="1"][data-to="5"]:not(.edge-merge)',
      ).length,
    ).toBe(0);
    assertEdgesOnPorts(container);
  });

  it("anchors an if's self-fed rails when no body and no continuation exist", () => {
    const container = renderState(
      [{ id: 1, kind: "if", next: null, condition: 2, then_body: [], else_body: [] }],
      { 0: { 1: { x: 48, y: 84 } }, 1: { 1: { x: 48, y: 84 } } },
      JOIN_STATE,
    );
    const rails = container.querySelectorAll(
      '#links path.edge-merge[data-fid="0"][data-from="1"][data-to="1"]',
    );
    expect(rails.length).toBe(2);
    // No continuation block: no circle→onward wire exists...
    const drawn = container.querySelectorAll("#links path.edge[data-fid='0']");
    expect(drawn.length).toBe(2);
    // ...so every drawn endpoint is one of the if card's TRUE/FALSE
    // ports or the join circle's in-top port.
    assertEdgesOnPorts(container);
  });
});
