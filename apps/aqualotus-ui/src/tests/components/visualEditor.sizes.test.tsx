import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import VisualEditor from "../../components/VisualEditor";
import type { CommandSummary } from "../../lib/optilotus";
import type { UiCommand } from "../../lib/program";

let observers: FakeObserver[] = [];

class FakeObserver {
  readonly callback: ResizeObserverCallback;
  readonly targets = new Set<Element>();
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    observers.push(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(): void {}
  disconnect(): void {
    observers = observers.filter((o) => o !== this);
  }
  report(sizes: ReadonlyMap<Element, { readonly w: number; readonly h: number }>): void {
    const entries = [...this.targets].map((target) => ({
      target,
      borderBoxSize: [{ inlineSize: sizes.get(target)?.w ?? 0, blockSize: sizes.get(target)?.h ?? 0 }],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
      contentRect: { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
    })) as unknown as ResizeObserverEntry[];
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

const CHAIN: readonly UiCommand[] = [
  { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
  { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
  { id: 3, kind: "print", next: null, template: '"n"' },
];

const HELPERS: readonly CommandSummary[] = [
  { id: 1, kind: "declare", next: null, var: "m", ty: "int32", expr: "1" },
];

function baseProps(): React.ComponentProps<typeof VisualEditor> {
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

const MEASURED = { w: 300, h: 200 };

function pathNumbers(d: string): number[] {
  return [...d.matchAll(/[-\d.]+/g)].map((m) => Number(m[0]));
}

function reportAll(sizes: { readonly w: number; readonly h: number }): void {
  for (const o of observers) {
    const map = new Map<Element, { readonly w: number; readonly h: number }>();
    for (const t of o.targets) map.set(t, sizes);
    o.report(map);
  }
}

describe("canvas size measurement (ResizeObserver)", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).ResizeObserver;
    observers = [];
  });

  it("drives connection anchors from measured block sizes, not the fallback", async () => {
    (globalThis as Record<string, unknown>).ResizeObserver = FakeObserver;
    const { container } = render(<VisualEditor {...baseProps()} />);
    await act(async () => {
      reportAll(MEASURED);
    });
    const edge = container.querySelector(
      '#links path.edge[data-fid="0"][data-from="1"][data-to="2"]',
    );
    expect(edge).not.toBeNull();
    await waitFor(() => {
      const nums = pathNumbers(edge?.getAttribute("d") ?? "");
      // outRight(1).x - inLeft(2).x == measured width of block 1
      // (all blocks share x = 48, so the function origin cancels).
      const dx = nums[0] - nums[nums.length - 2];
      expect(dx).toBeCloseTo(MEASURED.w, 1);
      // Regression guard: the fallback (216) must not be used once
      // sizes are observed.
      expect(dx).not.toBeCloseTo(216, 1);
    });
  });

  it("re-measures after a block resizes and slides the endpoint", async () => {
    (globalThis as Record<string, unknown>).ResizeObserver = FakeObserver;
    const { container, rerender } = render(<VisualEditor {...baseProps()} />);
    const edge = (): SVGPathElement | null =>
      container.querySelector(
        '#links path.edge[data-fid="0"][data-from="1"][data-to="2"]',
      ) as SVGPathElement | null;
    const dxOf = (e: SVGPathElement | null): number => {
      const nums = pathNumbers(e?.getAttribute("d") ?? "");
      return nums[0] - nums[nums.length - 2];
    };
    await act(async () => reportAll(MEASURED));
    await waitFor(() => expect(dxOf(edge())).toBeCloseTo(MEASURED.w, 1));

    const WIDER = { w: 420, h: 160 };
    await act(async () => {
      reportAll(WIDER);
      rerender(<VisualEditor {...baseProps()} />);
    });
    await waitFor(() => expect(dxOf(edge())).toBeCloseTo(WIDER.w, 1));
  });

  it("leaves no stale connection when a block is removed", async () => {
    (globalThis as Record<string, unknown>).ResizeObserver = FakeObserver;
    const { container, rerender } = render(<VisualEditor {...baseProps()} />);
    let edges = container.querySelectorAll(
      '#links path.edge[data-fid="0"]:not(.edge-preview)',
    );
    await waitFor(() => expect(edges.length).toBeGreaterThanOrEqual(2));

    const TWO: readonly UiCommand[] = [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
      { id: 2, kind: "assign", next: null, var: "n", expr: "{n} + 1" },
    ];
    rerender(
      <VisualEditor
        {...baseProps()}
        commandsByFunction={{ 0: TWO, 1: HELPERS }}
        layoutStore={{
          0: { 1: { x: 48, y: 84 }, 2: { x: 48, y: 240 } },
          1: { 1: { x: 48, y: 84 } },
        }}
      />,
    );
    edges = container.querySelectorAll(
      '#links path.edge[data-fid="0"][data-from="1"][data-to="3"]',
    );
    expect(edges.length).toBe(0);
    const surviving = container.querySelectorAll(
      '#links path.edge[data-fid="0"][data-from="1"][data-to="2"]',
    );
    expect(surviving.length).toBe(1);
  });
});
