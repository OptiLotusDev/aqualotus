import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AppShell from "./AppShell";
import type { ProgramSnapshot } from "../hooks/useProgram";
import type { RuntimeStatus } from "../hooks/useRuntime";

// jsdom has no `matchMedia`; the shell asks it for the compact layout.
if (typeof window !== "undefined" && window.matchMedia === undefined) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// The bridge is not part of this test: the shell only needs the
// function lookup that seeds the executed chain of the flow glow.
vi.mock("../lib/optilotus", () => ({
  optilotus_type: {
    int8: "int8",
    int16: "int16",
    int32: "int32",
    int64: "int64",
    uint8: "uint8",
    uint16: "uint16",
    uint32: "uint32",
    uint64: "uint64",
    float32: "float32",
    float64: "float64",
    bool: "bool",
    char: "char",
    string: "string",
    void: "void",
  },
  optilotus_getFunction: vi.fn(() => ({
    status: "ok",
    id: 0,
    name: "main",
    isMain: true,
    entry: 1,
    commandCount: 2,
  })),
}));

const RUNTIME: RuntimeStatus = {
  phase: "ready",
  version: "0.5.0",
  health: "ok",
  error: "",
};

function snapshot(): ProgramSnapshot {
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

function shellProps(): React.ComponentProps<typeof AppShell> {
  return {
    runtime: RUNTIME,
    program: snapshot(),
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

describe("AppShell error block attribution", () => {
  it("offers the failing block when the failure resolved to a visible block", () => {
    const props = {
      ...shellProps(),
      program: {
        ...snapshot(),
        run: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 2,
          message: "type mismatch at 2",
        },
        actionError: "TypeMismatch: type mismatch at 2",
        error: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 2,
          message: "type mismatch at 2",
        },
        errorBlockId: 2,
        errorFunctionId: 0,
      },
    };
    render(<AppShell {...props} />);
    expect(screen.getByRole("button", { name: /Show block #2/ })).toBeTruthy();
  });

  it("navigates to the exact block the failure points at", () => {
    const props = {
      ...shellProps(),
      program: {
        ...snapshot(),
        run: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 2,
          message: "type mismatch at 2",
        },
        actionError: "TypeMismatch: type mismatch at 2",
        errorBlockId: 2,
        errorFunctionId: 0,
      },
    };
    render(<AppShell {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Show block #2/ }));
    expect(props.onSelectCommand).toHaveBeenCalledWith(2);
  });

  it("offers no block when the failure could not be resolved", () => {
    // The engine reported the raw node that failed; for a print or a
    // cast that node belongs to a hidden node of the command's group,
    // so no visible block owns that id. The error text stays visible —
    // only the navigation action disappears.
    const props = {
      ...shellProps(),
      program: {
        ...snapshot(),
        run: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 7,
          message: "type mismatch at 7",
        },
        actionError: "TypeMismatch: type mismatch at 7",
        error: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 7,
          message: "type mismatch at 7",
        },
        errorBlockId: null,
        errorFunctionId: null,
      },
    };
    const { container } = render(<AppShell {...props} />);
    expect(container.textContent).toContain("TypeMismatch");
    expect(screen.queryByRole("button", { name: /Show block/ })).toBeNull();
  });

  it("offers no block for a target the graph no longer holds", () => {
    // The block was deleted after the failure: the target is stale, so
    // the navigation action must not survive it.
    const props = {
      ...shellProps(),
      program: {
        ...snapshot(),
        run: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 99,
          message: "type mismatch at 99",
        },
        actionError: "TypeMismatch: type mismatch at 99",
        errorBlockId: 99,
        errorFunctionId: 0,
      },
    };
    const { container } = render(<AppShell {...props} />);
    expect(container.textContent).toContain("TypeMismatch");
    expect(screen.queryByRole("button", { name: /Show block/ })).toBeNull();
  });

  it("highlights no block for an unresolved failure", () => {
    const props = {
      ...shellProps(),
      program: {
        ...snapshot(),
        run: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 7,
          message: "type mismatch at 7",
        },
        actionError: "TypeMismatch: type mismatch at 7",
        errorBlockId: null,
        errorFunctionId: null,
      },
    };
    const { container } = render(<AppShell {...props} />);
    // No block carries the failure marker: the UI must not blame an
    // arbitrary block for a failure it cannot attribute.
    expect(container.querySelectorAll('[data-error="true"]').length).toBe(0);
  });

  it("highlights the resolved block for an attributed failure", () => {
    const props = {
      ...shellProps(),
      program: {
        ...snapshot(),
        run: {
          status: "error" as const,
          kind: "TypeMismatch",
          command: 2,
          message: "type mismatch at 2",
        },
        actionError: "TypeMismatch: type mismatch at 2",
        errorBlockId: 2,
        errorFunctionId: 0,
      },
    };
    const { container } = render(<AppShell {...props} />);
    const failed = container.querySelectorAll('[data-error="true"]');
    expect(failed.length).toBe(1);
    expect(failed[0]?.getAttribute("data-block-id")).toBe("2");
  });
});

/* If/Else merge controls: toggling the manual join. Unmerge is
 * atomic — the circle goes away and the engine's continuation detaches
 * with it, in one action (task 4). */
function mergeSnapshot(): ProgramSnapshot {
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

describe("AppShell If/Else merge controls", () => {
  function openInspector(): {
    props: React.ComponentProps<typeof AppShell>;
    rerender: (ui: React.ReactElement) => void;
  } {
    const props = shellProps();
    Object.assign(props, { program: mergeSnapshot() });
    const view = render(<AppShell {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle inspector" }));
    return { props, rerender: view.rerender };
  }

  it("merges without touching the engine's links", () => {
    const { props } = openInspector();
    const toggle = screen.getByTestId("merge-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    // The join is presentation only: the button flips pressed, and no
    // bridge call rewires anything behind it.
    expect(screen.getByTestId("merge-toggle").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(props.onApplyLinks).not.toHaveBeenCalled();
  });

  it("unmerges atomically: join off and continuation detached, in one action", () => {
    const { props, rerender } = openInspector();
    // First click turns the join on (merge on: the drawing state only).
    fireEvent.click(screen.getByTestId("merge-toggle"));
    expect(props.onApplyLinks).not.toHaveBeenCalled();
    rerender(<AppShell {...props} />);
    // Second click unmerges: the continuation print 3 detaches in the
    // SAME action — the join's wires only exist while the join does.
    fireEvent.click(screen.getByTestId("merge-toggle"));
    expect(props.onApplyLinks).toHaveBeenCalledOnce();
    expect(props.onApplyLinks).toHaveBeenCalledWith(0, {
      edits: [{ id: 2, next: null }],
      entry: { type: "keep" },
    });
  });

  it("unmerge detaches nothing when the if has no continuation", () => {
    const props = shellProps();
    Object.assign(props, {
      program: {
        ...mergeSnapshot(),
        commands: mergeSnapshot().commands.map((cmd) =>
          cmd.id === 2 ? { ...cmd, next: null } : cmd,
        ),
        commandsByFunction: {
          0: mergeSnapshot()
            .commandsByFunction[0]!
            .map((cmd) => (cmd.id === 2 ? { ...cmd, next: null } : cmd)),
        },
      },
    });
    const view = render(<AppShell {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle inspector" }));
    fireEvent.click(screen.getByTestId("merge-toggle"));
    view.rerender(<AppShell {...props} />);
    fireEvent.click(screen.getByTestId("merge-toggle"));
    // Nothing to detach: no bridge call, the join toggle alone happened.
    expect(props.onApplyLinks).not.toHaveBeenCalled();
  });
});

describe("AppShell run action", () => {
  it("starts the flow travel with the run", async () => {
    const props = shellProps();
    const { container } = render(<AppShell {...props} />);
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(0);

    fireEvent.click(screen_runButton(container));
    expect(props.onRun).toHaveBeenCalledOnce();
    // The executed chain of `main` travels: one connection, one head.
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(1);
  });

  it("starts the flow travel from the keyboard shortcut too", () => {
    const props = shellProps();
    const { container } = render(<AppShell {...props} />);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(props.onRun).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(1);
  });

  it("restarts the travel on a repeated run without stacking indicators", () => {
    const props = shellProps();
    const { container } = render(<AppShell {...props} />);
    const run = screen_runButton(container);
    fireEvent.click(run);
    fireEvent.click(run);
    fireEvent.click(run);
    expect(props.onRun).toHaveBeenCalledTimes(3);
    // Still one indicator per connection: no duplicate animation loops.
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(1);
  });
});

describe("AppShell connection notice", () => {
  /** The notice lives in the runner panel; open it before asserting. */
  function openRunner(container: HTMLElement): void {
    const expand = container.querySelector(
      'button[aria-label="Expand runner"]',
    ) as HTMLButtonElement;
    expect(expand).not.toBeNull();
    fireEvent.click(expand);
  }

  it("does not count an `if` branch member as a disconnected block", () => {
    // The engine runs a branch member *from* the `if`, so it is not an
    // orphan: counting it would claim "the rest never print" about a
    // block that does print.
    const commands: ProgramSnapshot["commands"] = [
      { id: 1, kind: "if", next: null, condition: 2, then_body: [3] },
      { id: 3, kind: "print", next: null, template: '"in branch"' },
    ];
    const base = snapshot();
    const props = {
      ...shellProps(),
      program: {
        ...base,
        commands,
        commandsByFunction: { 0: commands },
      },
    };
    const { container } = render(<AppShell {...props} />);
    openRunner(container);
    expect(container.textContent ?? "").not.toContain("aren't connected");
  });

  it("still reports a block that really is disconnected", () => {
    const commands: ProgramSnapshot["commands"] = [
      { id: 1, kind: "print", next: null, template: '"A"' },
      { id: 3, kind: "print", next: null, template: '"B"' },
    ];
    const base = snapshot();
    const props = {
      ...shellProps(),
      program: {
        ...base,
        commands,
        commandsByFunction: { 0: commands },
      },
    };
    const { container } = render(<AppShell {...props} />);
    openRunner(container);
    expect(container.textContent ?? "").toContain("aren't connected");
  });

  it("does not count an `if` that is connected to the chain", () => {
    // The engine cannot report the edge into an `if` (its hidden
    // condition compute sits between the blocks), so the UI knows the
    // connection as a *planned* one. The notice must not claim that
    // the `if` never runs.
    const commands: ProgramSnapshot["commands"] = [
      { id: 1, kind: "print", next: 2, planned: true, template: '"A"' },
      { id: 2, kind: "if", next: null, condition: 3 },
    ];
    const base = snapshot();
    const props = {
      ...shellProps(),
      program: {
        ...base,
        commands,
        commandsByFunction: { 0: commands },
        entry: 1,
      },
    };
    const { container } = render(<AppShell {...props} />);
    openRunner(container);
    expect(container.textContent ?? "").not.toContain("aren't connected");
  });

  it("still reports an `if` that is not connected at all", () => {
    const commands: ProgramSnapshot["commands"] = [
      { id: 1, kind: "print", next: null, template: '"A"' },
      { id: 2, kind: "if", next: null, condition: 3 },
    ];
    const base = snapshot();
    const props = {
      ...shellProps(),
      program: {
        ...base,
        commands,
        commandsByFunction: { 0: commands },
        entry: 1,
      },
    };
    const { container } = render(<AppShell {...props} />);
    openRunner(container);
    expect(container.textContent ?? "").toContain("aren't connected");
  });
});

describe("AppShell panels", () => {
  it("opens and closes the blocks panel", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const toggle = container.querySelector(
      'button[aria-label="Toggle blocks panel"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      container.querySelector('aside[aria-label="Library and functions"]'),
    ).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('aside[aria-label="Library and functions"]'),
    ).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      container.querySelector('aside[aria-label="Library and functions"]'),
    ).toBeNull();
  });

  it("opens and closes the inspector", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const toggle = container.querySelector(
      'button[aria-label="Toggle inspector"]',
    ) as HTMLButtonElement;
    expect(container.querySelector('aside[aria-label="Inspector"]')).toBeNull();

    fireEvent.click(toggle);
    const panel = container.querySelector('aside[aria-label="Inspector"]');
    expect(panel).not.toBeNull();
    // The panel can be closed again from inside it.
    fireEvent.click(
      panel?.querySelector('button[aria-label="Hide inspector"]') as Element,
    );
    expect(container.querySelector('aside[aria-label="Inspector"]')).toBeNull();
  });

  it("expands and collapses the runner", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const expand = container.querySelector(
      'button[aria-label="Expand runner"]',
    ) as HTMLButtonElement;
    expect(expand).not.toBeNull();
    fireEvent.click(expand);
    expect(
      container.querySelector('section[aria-label="Runner"]'),
    ).not.toBeNull();

    const collapse = container.querySelector(
      'button[aria-label="Collapse runner"]',
    ) as HTMLButtonElement;
    fireEvent.click(collapse);
    expect(container.querySelector('section[aria-label="Runner"]')).toBeNull();
    // The collapsed runner stays reachable as a pill.
    expect(
      container.querySelector('button[aria-label="Expand runner"]'),
    ).not.toBeNull();
  });

  it("survives rapid open and close cycles without stale panels", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const left = container.querySelector(
      'button[aria-label="Toggle blocks panel"]',
    ) as HTMLButtonElement;
    const inspector = container.querySelector(
      'button[aria-label="Toggle inspector"]',
    ) as HTMLButtonElement;
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(left);
      fireEvent.click(inspector);
      fireEvent.click(left);
      fireEvent.click(inspector);
    }
    // The last click closed them: no stale panel is left behind, and the
    // toggles agree with what is on screen.
    expect(
      container.querySelectorAll('aside[aria-label="Library and functions"]')
        .length,
    ).toBe(0);
    expect(
      container.querySelectorAll('aside[aria-label="Inspector"]').length,
    ).toBe(0);
    expect(left.getAttribute("aria-pressed")).toBe("false");
    expect(inspector.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the canvas usable while a panel is open", async () => {
    const props = shellProps();
    const { container } = render(<AppShell {...props} />);
    fireEvent.click(
      container.querySelector(
        'button[aria-label="Toggle blocks panel"]',
      ) as Element,
    );
    // The open panel does not swallow the canvas: a block is still
    // selectable behind it.
    const block = container.querySelector('[data-block-id="1"]') as Element;
    fireEvent.pointerDown(block, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerUp(container.querySelector("#board") as Element, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    expect(props.onSelectCommand).toHaveBeenCalledWith(1);
  });

  it("does not move the canvas when the functions panel opens or closes", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const before = canvasState(container);

    const toggle = container.querySelector(
      'button[aria-label="Toggle blocks panel"]',
    ) as HTMLButtonElement;
    // Opening the panel overlays the canvas; it never reflows it.
    fireEvent.click(toggle);
    expect(canvasState(container)).toEqual(before);
    fireEvent.click(toggle);
    expect(canvasState(container)).toEqual(before);
    // Repeated toggles keep it stable too.
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(toggle);
    }
    expect(canvasState(container)).toEqual(before);
  });

  it("cannot switch to light mode while it is unavailable", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const toggle = container.querySelector(
      'button[aria-label="Light Mode is temporarily unavailable."]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    // Pressing it changes nothing.
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("night");
  });
});

/** A snapshot of everything the canvas layout owns. */
function canvasState(container: HTMLElement): {
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
function screen_runButton(container: HTMLElement): HTMLElement {
  const button = container.querySelector<HTMLElement>(
    'button[aria-label="Run program"], button[title="Run (Ctrl/Cmd + Enter)"]',
  );
  if (button === null) {
    throw new Error("run button not found");
  }
  return button;
}
