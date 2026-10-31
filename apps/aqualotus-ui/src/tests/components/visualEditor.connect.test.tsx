import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import VisualEditor from "../../components/VisualEditor";
import type { CommandSummary } from "../../lib/optilotus";
import type { UiCommand } from "../../lib/program";

const CHAIN: readonly UiCommand[] = [
  { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
  { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
  { id: 3, kind: "print", next: null, template: '"n"' },
];

const IF_BRANCH: readonly UiCommand[] = [
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

const HELPERS: readonly CommandSummary[] = [
  { id: 1, kind: "declare", next: null, var: "m", ty: "int32", expr: "1" },
];

function chainProps(): React.ComponentProps<typeof VisualEditor> {
  return {
    functions: [
      { id: 0, name: "main", isMain: true },
      { id: 1, name: "helper", isMain: false },
    ],
    commandsByFunction: { 0: CHAIN, 1: HELPERS },
    layoutStore: {
      0: {
        1: { x: 48, y: 84 },
        2: { x: 48, y: 240 },
        3: { x: 48, y: 396 },
      },
      1: { 1: { x: 48, y: 84 } },
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

function dragFrom(
  container: HTMLElement,
  port: Element,
  to: { x: number; y: number },
): void {
  const board = container.querySelector("#board") as HTMLElement;
  fireEvent.pointerDown(port, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
  act(() => {
    fireEvent.pointerMove(board, { pointerId: 1, clientX: to.x, clientY: to.y });
    vi.advanceTimersByTime(50);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("VisualEditor connect-from highlight", () => {
  it("lights the source block while a wire is being dragged from it", () => {
    vi.useFakeTimers();
    const { container } = render(<VisualEditor {...chainProps()} />);
    const port = container.querySelector(
      '.vport[data-fid="0"][data-block-id="1"][data-port="out"]',
    ) as Element;
    expect(port).not.toBeNull();
    dragFrom(container, port, { x: 40, y: 40 });

    const source = container.querySelector(
      '.vblock[data-fid="0"][data-block-id="1"]',
    ) as HTMLElement;
    const other = container.querySelector(
      '.vblock[data-fid="0"][data-block-id="2"]',
    ) as HTMLElement;
    expect(source.getAttribute("data-connect-from")).toBe("true");
    expect(other.getAttribute("data-connect-from")).toBe("false");
  });

  it("lights the join circle while a wire is being dragged from it", () => {
    vi.useFakeTimers();
    const { container } = render(
      <VisualEditor
        {...chainProps()}
        commandsByFunction={{ 0: IF_BRANCH, 1: HELPERS }}
        layoutStore={{
          0: {
            1: { x: 48, y: 84 },
            2: { x: 48, y: 300 },
            10: { x: 48, y: 452 },
            5: { x: 48, y: 700 },
          },
          1: { 1: { x: 48, y: 84 } },
        }}
        mergeJoins={{ 1: { on: true, pos: null } }}
      />,
    );
    const outPort = container.querySelector(
      '.vjoin[data-join-of="1"] .vport[data-port="out"]',
    ) as Element;
    expect(outPort).not.toBeNull();
    dragFrom(container, outPort, { x: 40, y: 40 });

    const join = container.querySelector(
      '.vjoin[data-join-of="1"]',
    ) as HTMLElement;
    expect(join.getAttribute("data-connect-from")).toBe("true");
  });

  it("does not linger on a block after the connection gesture ends", () => {
    vi.useFakeTimers();
    const { container } = render(<VisualEditor {...chainProps()} />);
    const port = container.querySelector(
      '.vport[data-fid="0"][data-block-id="1"][data-port="out"]',
    ) as Element;
    dragFrom(container, port, { x: 40, y: 40 });
    act(() => {
      fireEvent.pointerUp(container.querySelector("#board") as HTMLElement, {
        pointerId: 1,
        clientX: 40,
        clientY: 40,
      });
    });
    const source = container.querySelector(
      '.vblock[data-fid="0"][data-block-id="1"]',
    ) as HTMLElement;
    expect(source.getAttribute("data-connect-from")).toBe("false");
  });
});
