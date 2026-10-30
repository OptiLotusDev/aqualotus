import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Inspector from "../../components/Inspector";
import { inspectorProps, func } from "./inspector.test-helpers";

describe("Inspector function properties", () => {
  it("shows function properties when nothing is selected", () => {
    render(<Inspector {...inspectorProps()} />);
    expect(screen.getByText("Cleared — run is a no-op")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Clear entry point" }),
    ).toBeNull();
  });

  it("shows a live entry head with a clear action", async () => {
    const user = userEvent.setup();
    const props = { ...inspectorProps(), func: { ...func, entry: 3 }, entry: 3 };
    render(<Inspector {...props} />);
    expect(screen.getByText("Yes — starts at #3")).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Clear entry point" }),
    );
    expect(props.onClearEntry).toHaveBeenCalledOnce();
  });

  it("asks for a selection when idle", () => {
    render(<Inspector {...inspectorProps()} func={null} />);
    expect(
      screen.getByText("Select a block to inspect its properties."),
    ).toBeDefined();
  });

  it("offers a non-destructive declare for an undeclared variable", async () => {
    const user = userEvent.setup();
    const onDeclareVariable = vi.fn();
    render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "assign",
          next: null,
          var: "ghost",
          expr: "{ghost}",
        }}
        recoveryVar="ghost"
        onDeclareVariable={onDeclareVariable}
      />,
    );
    expect(screen.getByDisplayValue("{ghost}")).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: /Declare “ghost”/ }),
    );
    expect(onDeclareVariable).toHaveBeenCalledWith("ghost");
  });

  it("marks the declare initializer as optional", () => {
    render(
      <Inspector {...inspectorProps()} selected={{ id: 1, kind: "declare", next: null, var: "n", ty: "int32", expr: undefined }} />,
    );
    expect(screen.getByLabelText(/Value \(optional\)/)).toBeDefined();
  });

  it("demos each type's literal shape in the value field", () => {
    const { rerender } = render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "declare",
          next: null,
          var: "flag",
          ty: "bool",
          expr: "",
        }}
      />,
    );
    expect(screen.getByPlaceholderText("true")).toBeDefined();
    expect(screen.getByText(/comparisons live in Assign/)).toBeDefined();

    rerender(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 2,
          kind: "declare",
          next: null,
          var: "greeting",
          ty: "string",
          expr: "",
        }}
      />,
    );
    expect(screen.getByPlaceholderText('"hello"')).toBeDefined();
    expect(screen.getByText(/double quotes.*required/)).toBeDefined();

    rerender(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 3,
          kind: "declare",
          next: null,
          var: "initial",
          ty: "char",
          expr: "",
        }}
      />,
    );
    expect(screen.getByPlaceholderText("'a'")).toBeDefined();
    expect(screen.getByText(/single quotes/)).toBeDefined();
  });

  it("clears a stale value when the declare type switches", async () => {
    const user = userEvent.setup();
    render(
      <Inspector
        {...inspectorProps()}
        onReplace={vi.fn()}
        selected={{
          id: 1,
          kind: "declare",
          next: null,
          var: "n",
          ty: "int32",
          expr: "41",
        }}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Type"), "bool");
    expect(
      (screen.getByLabelText(/Value \(optional\)/) as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByPlaceholderText("true")).toBeDefined();
  });

  it("shows quoted stored values in the input rectangle", () => {
    render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "declare",
          next: null,
          var: "greeting",
          ty: "string",
          expr: "hi",
        }}
      />,
    );
    expect(screen.getByDisplayValue('"hi"')).toBeDefined();
  });

  it("rejects bare string/char values and blocks Apply", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    render(
      <Inspector
        {...inspectorProps()}
        onReplace={onReplace}
        selected={{
          id: 1,
          kind: "declare",
          next: null,
          var: "greeting",
          ty: "string",
          expr: "hi",
        }}
      />,
    );
    expect(screen.getByDisplayValue('"hi"')).toBeDefined();
    expect(screen.queryByTestId("declare-value-error")).toBeNull();
    await user.clear(screen.getByLabelText(/Value \(optional\)/));
    await user.type(screen.getByLabelText(/Value \(optional\)/), "hi");
    expect(screen.getByTestId("declare-value-error")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Apply edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.clear(screen.getByLabelText(/Value \(optional\)/));
    await user.type(screen.getByLabelText(/Value \(optional\)/), '"hi"');
    expect(screen.queryByTestId("declare-value-error")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Apply edit" }));
    expect(onReplace).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        kind: "declare",
        name: "greeting",
        init: '"hi"',
      }),
    );
  });

  it("edits and deletes the selected block", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const onDeleteBlock = vi.fn();
    render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "declare",
          next: null,
          var: "n",
          ty: "int32",
          expr: "41",
        }}
        onReplace={onReplace}
        onDeleteBlock={onDeleteBlock}
      />,
    );
    expect(screen.getByDisplayValue("41")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Apply edit" }));
    expect(onReplace).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ kind: "declare", name: "n" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete Block" }));
    expect(onDeleteBlock).toHaveBeenCalledWith(1);
  });
});
