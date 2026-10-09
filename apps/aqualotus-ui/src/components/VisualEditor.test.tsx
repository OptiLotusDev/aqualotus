import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VisualEditor from "./VisualEditor";
import type { CommandSummary } from "../lib/optilotus";

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
    chromeLeft: 0,
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
});
