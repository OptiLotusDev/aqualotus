import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AppShell from "../../components/AppShell";

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

import { screen_runButton, shellProps } from "./appShell.test-helpers";

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
