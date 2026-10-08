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
