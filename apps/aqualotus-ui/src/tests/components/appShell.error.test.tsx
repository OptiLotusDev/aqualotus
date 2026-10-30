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

import { shellProps } from "./appShell.test-helpers";

describe("AppShell error block attribution", () => {
  it("offers the failing block when the failure resolved to a visible block", () => {
    const props = shellProps({
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
    });
    render(<AppShell {...props} />);
    expect(screen.getByRole("button", { name: /Show block #2/ })).toBeTruthy();
  });

  it("navigates to the exact block the failure points at", () => {
    const props = shellProps({
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
    });
    render(<AppShell {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Show block #2/ }));
    expect(props.onSelectCommand).toHaveBeenCalledWith(2);
  });

  it("offers no block when the failure could not be resolved", () => {
    // The engine reported the raw node that failed; for a print or a
    // cast that node belongs to a hidden node of the command's group,
    // so no visible block owns that id. The error text stays visible —
    // only the navigation action disappears.
    const props = shellProps({
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
    });
    const { container } = render(<AppShell {...props} />);
    expect(container.textContent).toContain("TypeMismatch");
    expect(screen.queryByRole("button", { name: /Show block/ })).toBeNull();
  });

  it("offers no block for a target the graph no longer holds", () => {
    // The block was deleted after the failure: the target is stale, so
    // the navigation action must not survive it.
    const props = shellProps({
      run: {
        status: "error" as const,
        kind: "TypeMismatch",
        command: 99,
        message: "type mismatch at 99",
      },
      actionError: "TypeMismatch: type mismatch at 99",
      errorBlockId: 99,
      errorFunctionId: 0,
    });
    const { container } = render(<AppShell {...props} />);
    expect(container.textContent).toContain("TypeMismatch");
    expect(screen.queryByRole("button", { name: /Show block/ })).toBeNull();
  });

  it("highlights no block for an unresolved failure", () => {
    const props = shellProps({
      run: {
        status: "error" as const,
        kind: "TypeMismatch",
        command: 7,
        message: "type mismatch at 7",
      },
      actionError: "TypeMismatch: type mismatch at 7",
      errorBlockId: null,
      errorFunctionId: null,
    });
    const { container } = render(<AppShell {...props} />);
    // No block carries the failure marker: the UI must not blame an
    // arbitrary block for a failure it cannot attribute.
    expect(container.querySelectorAll('[data-error="true"]').length).toBe(0);
  });

  it("highlights the resolved block for an attributed failure", () => {
    const props = shellProps({
      run: {
        status: "error" as const,
        kind: "TypeMismatch",
        command: 2,
        message: "type mismatch at 2",
      },
      actionError: "TypeMismatch: type mismatch at 2",
      errorBlockId: 2,
      errorFunctionId: 0,
    });
    const { container } = render(<AppShell {...props} />);
    const failed = container.querySelectorAll('[data-error="true"]');
    expect(failed.length).toBe(1);
    expect(failed[0]?.getAttribute("data-block-id")).toBe("2");
  });
});
