import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VisualEditor from "./VisualEditor";
import type { CommandSummary } from "../lib/optilotus";

const COMMANDS: readonly CommandSummary[] = [
  { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
  { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
  { id: 3, kind: "print", next: null, template: '"{n}"' },
];

const POSITIONS = {
  1: { x: 180, y: 72 },
  2: { x: 180, y: 228 },
  3: { x: 180, y: 384 },
};

function baseProps(): React.ComponentProps<typeof VisualEditor> {
  return {
    functionName: "main",
    isMain: true,
    blockCount: COMMANDS.length,
    commands: COMMANDS,
    positions: POSITIONS,
    selectedId: null,
    errorId: null,
    busy: false,
    onSelect: vi.fn(),
    onReconnect: vi.fn(() => true),
    onMoveBlock: vi.fn(),
    onDropBlock: vi.fn(),
    onRegisterDrop: vi.fn(),
    onRegisterZoom: vi.fn(),
    onRequestLibrary: vi.fn(),
  };
}

describe("VisualEditor", () => {
  it("renders one block per command with its semantic content", () => {
    render(<VisualEditor {...baseProps()} />);
    expect(screen.getByText("n: int32")).toBeDefined();
    expect(screen.getByText("n = {n} + 1")).toBeDefined();
    expect(screen.getByText('"{n}"')).toBeDefined();
    expect(
      screen.getByRole("button", { name: /declare block 1/ }),
    ).toBeDefined();
  });

  it("draws one SVG edge per semantic link", () => {
    const { container } = render(<VisualEditor {...baseProps()} />);
    const edges = container.querySelectorAll("#links path.edge:not(.edge-preview)");
    expect(edges.length).toBe(2);
    for (const edge of edges) {
      expect(edge.getAttribute("d") ?? "").toMatch(/^M .* C .*$/);
    }
  });

  it("selects blocks and flags the error block", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <VisualEditor {...baseProps()} errorId={2} onSelect={onSelect} />,
    );
    expect(screen.getByText("Error reported here")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /assign block 2/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("shows the empty canvas with a path to the library", async () => {
    const user = userEvent.setup();
    const onRequestLibrary = vi.fn();
    render(
      <VisualEditor {...baseProps()} commands={[]} onRequestLibrary={onRequestLibrary} />,
    );
    expect(screen.getByText("No blocks yet")).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Open block library" }),
    );
    expect(onRequestLibrary).toHaveBeenCalledOnce();
  });

  it("positions do not affect semantic identity", () => {
    const moved = {
      1: { x: 900, y: 900 },
      2: { x: 10, y: 10 },
      3: { x: 400, y: 40 },
    };
    const { container } = render(
      <VisualEditor {...baseProps()} positions={moved} />,
    );
    expect(screen.getByText("n: int32")).toBeDefined();
    const block = container.querySelector('[data-block-id="1"]');
    expect(block?.getAttribute("style") ?? "").toContain("900px");
  });
});
