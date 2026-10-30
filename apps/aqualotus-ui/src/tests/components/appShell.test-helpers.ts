import type AppShell from "../../components/AppShell";
import type { ProgramSnapshot } from "../../hooks/useProgram";
import type { RuntimeStatus } from "../../hooks/useRuntime";
import { vi } from "vitest";

export const RUNTIME: RuntimeStatus = {
  phase: "ready",
  version: "0.5.0",
  health: "ok",
  error: "",
};

export function snapshot(): ProgramSnapshot {
  return {
    functions: [{ id: 0, name: "main", isMain: true }],
    selectedId: 0,
    selected: {
      status: "ok",
      id: 0,
      name: "main",
      isMain: true,
      entry: 1,
      commandCount: 2,
    },
    entry: 1,
    commands: [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
      { id: 2, kind: "print", next: null, template: '"{n}"' },
    ],
    commandsByFunction: {
      0: [
        { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
        { id: 2, kind: "print", next: null, template: '"{n}"' },
      ],
    },
    selectedCommandId: null,
    run: null,
    running: false,
    durationMs: null,
    busy: false,
    actionError: "",
    error: null,
    errorBlockId: null,
    errorFunctionId: null,
    recoveryVar: null,
  };
}

export function shellProps(
  programOverrides: Partial<ProgramSnapshot> = {},
): React.ComponentProps<typeof AppShell> {
  return {
    runtime: RUNTIME,
    program: { ...snapshot(), ...programOverrides },
    issueSeq: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    undoSeq: null,
    redoSeq: null,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSelectFunction: vi.fn(),
    onSelectCommand: vi.fn(),
    onCreateFunction: vi.fn(),
    onRenameFunction: vi.fn(),
    onDeleteFunction: vi.fn(),
    onAddCommand: vi.fn(),
    onDeclareVariable: vi.fn(),
    onReplaceCommand: vi.fn(),
    onDeleteCommand: vi.fn(),
    onApplyLinks: vi.fn(),
    onAppendIfBranch: vi.fn(() => true),
    onConditionText: vi.fn(() => null),
    onClearEntry: vi.fn(),
    onClearPackage: vi.fn(),
    onRun: vi.fn(),
    onDismissError: vi.fn(),
  };
}

export function mergeSnapshot(): ProgramSnapshot {
  return {
    ...snapshot(),
    commands: [
      { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
      { id: 2, kind: "if", next: 3, condition: 4, then_body: [], else_body: [] },
      { id: 3, kind: "print", next: null, template: '"after"' },
    ],
    commandsByFunction: {
      0: [
        { id: 1, kind: "declare", next: 2, var: "n", ty: "int32", expr: "41" },
        { id: 2, kind: "if", next: 3, condition: 4, then_body: [], else_body: [] },
        { id: 3, kind: "print", next: null, template: '"after"' },
      ],
    },
    selectedCommandId: 2,
  };
}

/** A snapshot of everything the canvas layout owns. */
export function canvasState(container: HTMLElement): {
  readonly blocks: readonly string[];
  readonly containers: readonly string[];
  readonly edges: readonly (string | null)[];
  readonly zoom: string | null;
  readonly scroll: { readonly left: number; readonly top: number };
} {
  const board = container.querySelector("#board") as HTMLElement;
  return {
    blocks: [...container.querySelectorAll(".vblock")].map(
      (b) => b.getAttribute("style") ?? "",
    ),
    containers: [
      ...container.querySelectorAll(".pkg-pos, .struct-pos, .funcc, .structc, .pkg"),
    ].map((c) => c.getAttribute("style") ?? ""),
    edges: [...container.querySelectorAll("path.edge")].map((e) =>
      e.getAttribute("d"),
    ),
    zoom:
      container
        .querySelector('[aria-label*="Zoom level"]')
        ?.getAttribute("aria-label") ?? null,
    scroll: { left: board.scrollLeft, top: board.scrollTop },
  };
}

/** The app bar's run button (compact and desktop variants). */
export function screen_runButton(container: HTMLElement): HTMLElement {
  const button = container.querySelector<HTMLElement>(
    'button[aria-label="Run program"], button[title="Run (Ctrl/Cmd + Enter)"]',
  );
  if (button === null) {
    throw new Error("run button not found");
  }
  return button;
}
