import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AppShell from "../../components/AppShell";
import type { ProgramSnapshot } from "../../hooks/useProgram";

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

vi.mock("../../lib/optilotus", () => ({
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

import { shellProps, snapshot } from "./appShell.test-helpers";

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
