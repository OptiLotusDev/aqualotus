import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FunctionBrowser from "./FunctionBrowser";
import Inspector from "./Inspector";
import Runner from "./Runner";
import BlockLibrary from "./BlockLibrary";
import ProjectNavigator from "./ProjectNavigator";
import { EXIT_MS } from "../hooks/useExitItems";

describe("FunctionBrowser", () => {
  it("marks main and selects by stable id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FunctionBrowser
        functions={[
          { id: 0, name: "main", isMain: true },
          { id: 1, name: "helper", isMain: false },
        ]}
        selectedId={0}
        busy={false}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("MAIN")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /helper/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("shows the empty list and deletes the selected helper", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const { rerender } = render(
      <FunctionBrowser
        functions={[]}
        selectedId={null}
        busy={false}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText("No blocks")).toBeDefined();
    // Creation lives in the Library's Function block; the list only
    // offers deletion of the selected non-main function.
    rerender(
      <FunctionBrowser
        functions={[
          { id: 0, name: "main", isMain: true },
          { id: 1, name: "helper", isMain: false },
        ]}
        selectedId={1}
        busy={false}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Delete selected function" }),
    );
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("renames a function in place and cancels a rename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const props = {
      selectedId: 0,
      busy: false,
      onSelect: vi.fn(),
      onDelete: vi.fn(),
      onRename,
    };
    const { rerender } = render(
      <FunctionBrowser
        {...props}
        functions={[
          { id: 0, name: "main", isMain: true },
          { id: 1, name: "helper", isMain: false },
        ]}
      />,
    );
    // The rename opens an inline editor on the row itself.
    await user.click(screen.getByRole("button", { name: "Rename helper" }));
    const input = screen.getByLabelText("New function name");
    await user.clear(input);
    await user.type(input, "worker");
    await user.click(screen.getByRole("button", { name: "✓" }));
    expect(onRename).toHaveBeenCalledWith(1, "worker");

    // A cancelled rename changes nothing and leaves the row as it was.
    onRename.mockClear();
    await user.click(screen.getByRole("button", { name: "Rename helper" }));
    await user.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("helper")).toBeDefined();

    // The list survives the edit cycle.
    rerender(
      <FunctionBrowser
        {...props}
        functions={[
          { id: 0, name: "main", isMain: true },
          { id: 1, name: "worker", isMain: false },
        ]}
      />,
    );
    expect(screen.getByText("worker")).toBeDefined();
    expect(screen.queryByText("helper")).toBeNull();
  });

  it("fades a deleted function row out, then removes it", () => {
    vi.useFakeTimers();
    try {
      const props = {
        selectedId: 0,
        busy: false,
        onSelect: vi.fn(),
        onDelete: vi.fn(),
      };
      const { container, rerender } = render(
        <FunctionBrowser
          {...props}
          functions={[
            { id: 0, name: "main", isMain: true },
            { id: 1, name: "helper", isMain: false },
          ]}
        />,
      );
      // The function is gone from the model; its row finishes leaving.
      rerender(
        <FunctionBrowser
          {...props}
          functions={[{ id: 0, name: "main", isMain: true }]}
        />,
      );
      const ghost = container.querySelector('[data-exiting="true"]');
      expect(ghost).not.toBeNull();
      expect(ghost?.textContent ?? "").toContain("helper");
      expect(screen.queryByRole("button", { name: /helper/ })).toBeNull();

      act(() => {
        vi.advanceTimersByTime(EXIT_MS + 50);
      });
      expect(container.querySelector('[data-exiting="true"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Runner", () => {
  function runnerProps(): React.ComponentProps<typeof Runner> {
    return {
      run: null,
      running: false,
      durationMs: null,
      errorId: null,
      onShowBlock: vi.fn(),
    };
  }

  it("renders the panel heading and run action", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <Runner {...runnerProps()} onRun={onRun} busy={false} canRun={true} />,
    );
    expect(screen.getByTestId("runner-panel")).toBeDefined();
    expect(screen.getByText("Runner")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Run program" }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("renders running state distinctly from idle", () => {
    const { rerender } = render(<Runner {...runnerProps()} />);
    expect(screen.getByTestId("runner-empty")).toBeDefined();
    expect(screen.getByText("Ready to run")).toBeDefined();
    expect(
      screen.getByText("Run the program to see output here."),
    ).toBeDefined();

    rerender(<Runner {...runnerProps()} running={true} />);
    expect(screen.getByTestId("runner-running")).toBeDefined();
    expect(screen.getByText("Running…")).toBeDefined();
    expect(screen.getByTestId("runner-status").dataset.state).toBe("busy");
  });

  it("renders idle, ok with duration, and error states", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Runner {...runnerProps()} />);
    expect(screen.getByText("Ready to run")).toBeDefined();
    expect(
      screen.getByText("Run the program to see output here."),
    ).toBeDefined();

    rerender(
      <Runner
        {...runnerProps()}
        run={{ status: "ok", steps: 6, prints: 1, printed: ["42"], returned: null }}
        durationMs={4.2}
      />,
    );
    expect(screen.getByTestId("runner-success")).toBeDefined();
    expect(screen.getByText("> 42")).toBeDefined();
    expect(screen.getByText("6", { selector: "strong" })).toBeDefined();
    expect(screen.getByText("4.2 ms")).toBeDefined();

    const onShowBlock = vi.fn();
    rerender(
      <Runner
        {...runnerProps()}
        run={{
          status: "error",
          kind: "UnknownFunction",
          command: 7,
          message: 'unknown function "helper"',
        }}
        errorId={7}
        onShowBlock={onShowBlock}
      />,
    );
    expect(screen.getByTestId("runner-error")).toBeDefined();
    expect(
      screen.getByTestId("runner-error").textContent ?? "",
    ).toContain("Run failed");
    await user.click(screen.getByRole("button", { name: "Show block #7" }));
    expect(onShowBlock).toHaveBeenCalledWith(7);
  });

  it("announces success without output as its own empty state", () => {
    render(
      <Runner
        {...runnerProps()}
        run={{ status: "ok", steps: 2, prints: 0, printed: [], returned: null }}
        durationMs={1.5}
      />,
    );
    expect(
      screen.getByText("Run completed — no printed output."),
    ).toBeDefined();
  });

  it("shows the error type, message and structured fields", () => {
    render(
      <Runner
        {...runnerProps()}
        run={{
          status: "error",
          kind: "UnknownVariable",
          command: 3,
          message: 'unknown variable "ghost" at 3',
          var: "ghost",
        }}
        errorId={null}
      />,
    );
    const panel = screen.getByTestId("runner-error");
    // The engine's family and message are shown unchanged.
    expect(panel.textContent ?? "").toContain("UnknownVariable");
    expect(panel.textContent ?? "").toContain('unknown variable "ghost" at 3');
    // The kind-specific field survives too.
    expect(screen.getByTestId("runner-error-field-variable").textContent).toBe(
      "Variable: ghost",
    );
  });

  it("offers no navigation action for an unresolved failure", () => {
    render(
      <Runner
        {...runnerProps()}
        run={{
          status: "error",
          kind: "TypeMismatch",
          command: 4,
          message: "type mismatch at 4",
        }}
        errorId={null}
      />,
    );
    // The failure is still visible…
    expect(screen.getByTestId("runner-error")).toBeDefined();
    expect(screen.getByTestId("runner-error").textContent ?? "").toContain(
      "TypeMismatch",
    );
    // …but no block is offered: the engine's id names a hidden node.
    expect(screen.queryByRole("button", { name: /Show block/ })).toBeNull();
  });

  it("navigates to the exact resolved block", async () => {
    const user = userEvent.setup();
    const onShowBlock = vi.fn();
    render(
      <Runner
        {...runnerProps()}
        run={{
          status: "error",
          kind: "UnknownVariable",
          command: 3,
          message: 'unknown variable "ghost" at 3',
        }}
        errorId={3}
        onShowBlock={onShowBlock}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show block #3" }));
    expect(onShowBlock).toHaveBeenCalledWith(3);
  });
});

describe("BlockLibrary", () => {
  function libraryProps(): React.ComponentProps<typeof BlockLibrary> {
    return { busy: false, onAdd: vi.fn(), onDropToCanvas: vi.fn() };
  }

  it("lists exactly the api.md blocks and adds them", async () => {
    const user = userEvent.setup();
    const props = libraryProps();
    render(<BlockLibrary {...props} />);
    // The unfiltered library really does offer the conditional block, so
    // the filtered assertion below is a real one (the library labels it
    // "If / Else").
    expect(
      screen.getByRole("button", { name: /Add If \/ Else block/ }),
    ).toBeDefined();
    await user.type(
      screen.getByPlaceholderText("Search blocks…"),
      "declare variable",
    );
    await user.click(
      screen.getByRole("button", { name: /Add Declare Variable block/ }),
    );
    expect(props.onAdd).toHaveBeenCalledWith("declare");
    // Nothing beyond the engine surface exists in the list: the search
    // for "declare variable" must not offer the If block.
    expect(
      screen.queryByRole("button", { name: /Add If \/ Else block/ }),
    ).toBeNull();
    await user.clear(screen.getByPlaceholderText("Search blocks…"));
    await user.type(screen.getByPlaceholderText("Search blocks…"), "zzz-nope");
    expect(screen.getByText("No blocks match")).toBeDefined();
    await user.clear(screen.getByPlaceholderText("Search blocks…"));
    await user.type(screen.getByPlaceholderText("Search blocks…"), "while loop");
    expect(screen.getByText("No blocks match")).toBeDefined();
  });

  it("shows a ghost while dragging and drops nothing outside the board", () => {
    const props = libraryProps();
    render(<BlockLibrary {...props} />);
    const btn = screen.getByRole("button", {
      name: /Add Declare Variable block/,
    });
    fireEvent.pointerDown(btn, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 80 });
    // Portaled to the body so it paints above every pane.
    expect(document.body.querySelector(".lib-ghost")).not.toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 80 });
    expect(document.body.querySelector(".lib-ghost")).toBeNull();
    // Released outside the board (jsdom has no layout): no drop, no add.
    expect(props.onDropToCanvas).not.toHaveBeenCalled();
    expect(props.onAdd).not.toHaveBeenCalled();
  });
});

describe("ProjectNavigator", () => {
  function navigatorProps(): React.ComponentProps<typeof ProjectNavigator> {
    return {
      functions: [{ id: 0, name: "main", isMain: true }],
      selectedId: 0,
      busy: false,
      onSelect: vi.fn(),
      onDelete: vi.fn(),
      onRenameFunction: vi.fn(),
      libraryBusy: false,
      onAddBlock: vi.fn(),
      onClearPackage: vi.fn(),
      onDropToCanvas: vi.fn(),
    };
  }

  it("asks twice before resetting the project", async () => {
    const user = userEvent.setup();
    const props = navigatorProps();
    render(<ProjectNavigator {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Reset project" }),
    );
    // First click only arms; nothing destructive fires yet.
    expect(props.onClearPackage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, reset" }));
    expect(props.onClearPackage).toHaveBeenCalledOnce();
  });

  it("cancels the reset without touching the project", async () => {
    const user = userEvent.setup();
    const props = navigatorProps();
    render(<ProjectNavigator {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Reset project" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClearPackage).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Reset project" }),
    ).toBeDefined();
  });
});

describe("Inspector", () => {
  const func = {
    status: "ok" as const,
    id: 0,
    name: "main",
    isMain: true,
    entry: null,
    commandCount: 1,
  };

  function inspectorProps(): React.ComponentProps<typeof Inspector> {
    return {
      func,
      entry: func.entry,
      selected: null,
      busy: false,
      onReplace: vi.fn(),
      onDeleteBlock: vi.fn(),
      onDeleteFunction: vi.fn(),
      onClearEntry: vi.fn(),
    };
  }

  it("shows function properties when nothing is selected", () => {
    render(<Inspector {...inspectorProps()} />);
    expect(screen.getByText("Cleared — run is a no-op")).toBeDefined();
    // A cleared entry offers no clear action.
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

  it("offers every engine type tag, not a subset", async () => {
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
          var: "n",
          ty: "int32",
          expr: "41",
        }}
      />,
    );
    const select = screen.getByLabelText("Type");
    const options = [...select.querySelectorAll("option")].map(
      (o) => o.value,
    );
    for (const ty of [
      "int8",
      "int16",
      "int32",
      "int64",
      "int128",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
      "uint128",
      "float32",
      "float64",
      "bool",
      "char",
      "string",
    ]) {
      expect(options).toContain(ty);
    }
    // `void` is the one engine tag a declare can never use.
    expect(options).not.toContain("void");
    // A non-default tag survives the edit round-trip.
    await user.selectOptions(select, "uint8");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));
    expect(onReplace).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ kind: "declare", ty: "uint8" }),
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
    // The failed block stays visible and editable…
    expect(screen.getByDisplayValue("{ghost}")).toBeDefined();
    // …with a recovery action that declares instead of deleting.
    await user.click(
      screen.getByRole("button", { name: /Declare “ghost”/ }),
    );
    expect(onDeclareVariable).toHaveBeenCalledWith("ghost");
  });

  it("marks the declare initializer as optional", () => {
    render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "declare",
          next: null,
          var: "n",
          ty: "int32",
          expr: undefined,
        }}
      />,
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
    // "41" belongs to int32 and would make the engine reject a `bool`
    // edit (leaving the block visibly frozen on int32), so switching
    // the type resets the value to the new default instead.
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
    // Stored bare, displayed quoted — the literal form survives edits.
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
    // Stored bare, displayed quoted and valid…
    expect(screen.getByDisplayValue('"hi"')).toBeDefined();
    expect(screen.queryByTestId("declare-value-error")).toBeNull();
    // …until the user strips the quotes: bare text errors and Apply
    // stays off.
    await user.clear(screen.getByLabelText(/Value \(optional\)/));
    await user.type(screen.getByLabelText(/Value \(optional\)/), "hi");
    expect(screen.getByTestId("declare-value-error")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Apply edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // Quoting clears the error and re-enables Apply.
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
});

describe("FunctionBrowser rename", () => {
  it("edits a name inline and reports it", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <FunctionBrowser
        functions={[
          { id: 0, name: "main", isMain: true },
          { id: 1, name: "helper", isMain: false },
        ]}
        selectedId={0}
        busy={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Rename helper" }));
    const input = screen.getByLabelText("New function name");
    await user.clear(input);
    await user.type(input, "worker");
    await user.click(screen.getByRole("button", { name: "✓" }));
    expect(onRename).toHaveBeenCalledWith(1, "worker");
  });

  it("renames main too (identity is the stable id)", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <FunctionBrowser
        functions={[{ id: 0, name: "main", isMain: true }]}
        selectedId={0}
        busy={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Rename main" }));
    const input = screen.getByLabelText("New function name");
    await user.clear(input);
    await user.type(input, "entry");
    await user.click(screen.getByRole("button", { name: "✓" }));
    expect(onRename).toHaveBeenCalledWith(0, "entry");
  });
});

describe("Inspector rename function", () => {
  const func = {
    status: "ok" as const,
    id: 0,
    name: "main",
    isMain: true,
    entry: null,
    commandCount: 1,
  };

  function baseProps(): React.ComponentProps<typeof Inspector> {
    return {
      func,
      entry: func.entry,
      selected: null,
      busy: false,
      onReplace: vi.fn(),
      onDeleteBlock: vi.fn(),
      onDeleteFunction: vi.fn(),
      onClearEntry: vi.fn(),
    };
  }

  it("renames the function from the Inspector", async () => {
    const user = userEvent.setup();
    const onRenameFunction = vi.fn();
    render(<Inspector {...baseProps()} onRenameFunction={onRenameFunction} />);
    const input = screen.getByLabelText("Function name");
    await user.clear(input);
    await user.type(input, "entry");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(onRenameFunction).toHaveBeenCalledWith("entry");
  });
});
