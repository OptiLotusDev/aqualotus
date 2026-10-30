import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    const typeLine = screen.getByTestId("casting-target-type-2");
    expect(typeLine.textContent).toBe("type: float64");
    const assign = screen.getByRole("button", {
      name: /assign block 2 in main/,
    });
    expect(assign.contains(annotation)).toBe(true);
    expect(annotation.contains(typeLine)).toBe(true);
    expect(screen.getAllByText("Casting Enabled")).toHaveLength(1);
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
    expect(assign.contains(annotation)).toBe(true);
    expect(annotation.contains(connector)).toBe(true);
    expect(connector.getAttribute("aria-hidden")).toBe("true");
    expect(annotation.getAttribute("data-casting-assignment")).toBe("2");
    expect(annotation.getAttribute("data-casting-target")).toBe("float64");
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
      expect(screen.getByTestId("casting-target-type-2").textContent).toBe(
        "type: int32",
      );
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
