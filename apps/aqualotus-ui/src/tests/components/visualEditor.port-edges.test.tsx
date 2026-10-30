import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import VisualEditor from "../../components/VisualEditor";
import type { UiCommand } from "../../lib/program";
import { JOIN_FALLBACK_SIZE } from "../../lib/graph";

const MAIN_COMMANDS: readonly UiCommand[] = [
  { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
  { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
  { id: 3, kind: "print", next: null, template: '"n"' },
];

const HELPER_COMMANDS: readonly UiCommand[] = [
  { id: 1, kind: "declare", next: null, var: "m", ty: "int32", expr: "1" },
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

const CHAIN: readonly UiCommand[] = [
  { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
  { id: 2, kind: "assign", next: 3, var: "n", expr: "{n} + 1" },
  { id: 3, kind: "print", next: null, template: '"n"' },
];

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

const BLOCK_W = 216;
const BLOCK_H = 104;

function px(styleValue: string): number {
  return Number(styleValue.replace("px", ""));
}

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
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(".vjoin"))) {
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

function portCenter(
  rect: { x: number; y: number; w: number; h: number },
  role: string,
): { x: number; y: number } {
  switch (role) {
    case "inLeft":
      return { x: rect.x, y: rect.y + rect.h / 2 };
    case "outRight":
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    case "then":
      return { x: rect.x + rect.w * 0.3, y: rect.y + rect.h };
    case "else":
      return { x: rect.x + rect.w * 0.7, y: rect.y + rect.h };
    case "inTop":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "outBottom":
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case "joinIn":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "joinOut":
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    default:
      return { x: rect.x, y: rect.y };
  }
}

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
      commandsByFunction={{ 0: commands, 1: HELPER_COMMANDS }}
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

describe("VisualEditor port-centred edges (§6)", () => {
  it("anchors a plain chain on the side ports only", () => {
    const container = renderState(CHAIN, CHAIN_LAYOUT);
    requireEdge(container, 0, 1, 2, false);
    requireEdge(container, 0, 2, 3, false);
    assertEdgesOnPorts(container);
  });

  it("anchors branch, body and classic-merge wires on their port circles", () => {
    const container = renderState(IF_BODY, IF_BODY_LAYOUT);
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
    const drawn = container.querySelectorAll("#links path.edge[data-fid='0']");
    expect(drawn.length).toBe(2);
    assertEdgesOnPorts(container);
  });
});
