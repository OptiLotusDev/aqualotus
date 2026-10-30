import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import VisualEditor from "../../components/VisualEditor";
import type { CommandSummary } from "../../lib/optilotus";
import type { UiCommand } from "../../lib/program";

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
    expect(edges[0]?.classList.contains("edge-planned")).toBe(true);
  });

  it("anchors the branch wire at the branch's first visible block", () => {
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
