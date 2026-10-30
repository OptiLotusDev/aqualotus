import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

import { mergeSnapshot, shellProps } from "./appShell.test-helpers";

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
