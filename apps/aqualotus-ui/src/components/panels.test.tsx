import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FunctionBrowser from "./FunctionBrowser";
import Inspector from "./Inspector";
import Runner from "./Runner";
import BlockLibrary from "./BlockLibrary";
import ProjectNavigator from "./ProjectNavigator";
import type { UiCommand } from "../lib/program";
import { convertedVariableName } from "../lib/casting";
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

  it("renders Casting as a compact inline checkbox beside its label", () => {
    render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "assign",
          next: null,
          var: "n",
          ty: "int32",
          expr: "{n} + 1",
        }}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Casting" });
    expect(checkbox).toHaveProperty("type", "checkbox");
    expect(checkbox).toHaveProperty("checked", false);
    const label = checkbox.closest("label");
    expect(label).not.toBeNull();
    expect(label?.className).toBe("field-check-label");
    expect(label?.textContent).toBe("Casting");
    expect(screen.getByTestId("assign-casting").className).toContain(
      "field-check",
    );
  });

  it("offers every engine type tag as a cast target (no void)", async () => {
    const user = userEvent.setup();
    render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "assign",
          next: null,
          var: "f",
          ty: "float64",
          expr: "{n}",
        }}
      />,
    );
    // Casting is disabled by default: no target type selector shown.
    expect(screen.queryByLabelText("Cast to type")).toBeNull();
    // Enabling it reveals the target menu in the same Inspector.
    await user.click(screen.getByLabelText(/Casting/));
    const select = screen.getByLabelText("Cast to type") as HTMLSelectElement;
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
    expect(options).not.toContain("void");
    // No target is selected automatically: the empty option is kept.
    expect(select.value).toBe("");
  });

  it("marks casting incomplete until a target type is chosen", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    render(
      <Inspector
        {...inspectorProps()}
        onReplace={onReplace}
        selected={{
          id: 1,
          kind: "assign",
          next: null,
          var: "f",
          ty: "float64",
          expr: "{n}",
        }}
      />,
    );
    await user.click(screen.getByLabelText(/Casting/));
    // Enabled but no target type: incomplete state shown.
    expect(screen.getByTestId("cast-incomplete").textContent).toContain(
      "Select a target type to complete casting.",
    );
    // The incomplete configuration cannot be applied: no Engine write
    // is submitted from a half-finished conversion.
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", true);
    // Source and destination stay visible while choosing.
    expect(
      (screen.getByLabelText(/Value/) as HTMLInputElement).value,
    ).toBe("{n}");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "f",
    );
    // Choosing a target completes the draft.
    await user.selectOptions(screen.getByLabelText("Cast to type"), "float64");
    expect(screen.queryByTestId("cast-incomplete")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Apply edit" }));
    expect(onReplace).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        kind: "assign",
        name: "f",
        expr: "{n}",
        casting: { enabled: true, targetType: "float64" },
      }),
    );
  });

  it("hydrates Casting from a projected conversion assignment", () => {
    const projected = {
      id: 1,
      kind: "assign",
      next: null,
      var: "f",
      ty: "float64",
      expr: "{n}",
      casting: {
        anchorId: 7,
        castId: 8,
        tempName: "__aqualotus_internal_cast_1",
        destinationName: "f",
        sourceExpr: "{n}",
        targetType: "float64",
      },
    } satisfies UiCommand;
    render(<Inspector {...inspectorProps()} selected={projected} />);
    expect(
      (screen.getByLabelText(/Casting/) as HTMLInputElement).checked,
    ).toBe(true);
    const select = screen.getByLabelText("Cast to type") as HTMLSelectElement;
    expect(select.value).toBe("float64");
    expect(screen.getByTestId("cast-preview").textContent).toContain(
      "Source: {n}",
    );
    expect(screen.getByTestId("cast-preview").textContent).toContain(
      "Destination: f (float64)",
    );
    // The old "Engine limitation" notice is gone: this configuration is
    // executable through the bridge.
    expect(screen.queryByTestId("casting-engine-limitation")).toBeNull();
  });

  it("does not submit anything when Casting is only toggled", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    render(
      <Inspector
        {...inspectorProps()}
        onReplace={onReplace}
        selected={{
          id: 1,
          kind: "assign",
          next: null,
          var: "n",
          ty: "int32",
          expr: "{n} + 1",
        }}
      />,
    );
    await user.click(screen.getByLabelText(/Casting/));
    expect(onReplace).not.toHaveBeenCalled();
    // Toggling is draft state only; Apply is still required (and blocked
    // until a target is chosen).
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", true);
  });

  it("names the new converted variable for a cross-type target and allows Apply", () => {
    const projected = {
      id: 1,
      kind: "assign",
      next: null,
      var: "f",
      ty: "float64",
      expr: "{n}",
      casting: {
        anchorId: 7,
        castId: 8,
        tempName: "__aqualotus_internal_cast_1",
        destinationName: "f",
        sourceExpr: "{n}",
        targetType: "int32",
      },
    } satisfies UiCommand;
    render(<Inspector {...inspectorProps()} selected={projected} />);
    // A target that differs from the destination is fully valid: the
    // apply creates the converted value in a new int32 variable, so the
    // Inspector names that variable instead of blocking the choice.
    const converted = screen.getByTestId("cast-converted-variable");
    expect(converted.getAttribute("data-cast-converted-name")).toBe("f_i32");
    expect(converted.getAttribute("data-cast-target-type")).toBe("int32");
    expect(converted.textContent).toContain("Converted variable: f_i32 (int32)");
    expect(screen.getByTestId("cast-converted-note").textContent).toContain(
      "creates the converted value in a new int32 variable",
    );
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);
  });

  it("never claims a second conversion into the destination's declared type", () => {
    const projected = {
      id: 1,
      kind: "assign",
      next: null,
      var: "f",
      ty: "float64",
      expr: "{n}",
      casting: {
        anchorId: 7,
        castId: 8,
        tempName: "__aqualotus_internal_cast_1",
        destinationName: "f",
        sourceExpr: "{n}",
        targetType: "int32",
      },
    } satisfies UiCommand;
    const { container } = render(
      <Inspector {...inspectorProps()} selected={projected} />,
    );
    // The regressed explanation claimed the value is "first converted to
    // int32, then to float64 (the destination's declared type) before
    // storing". The real operation creates one new int32 variable and
    // never converts back, so no such claim may appear.
    const text = container.textContent ?? "";
    expect(text).not.toContain("then to");
    expect(text).not.toContain("before storing");
    expect(text).not.toContain("second conversion");
    expect(screen.queryByTestId("cast-store-note")).toBeNull();
    // The converted variable is a real program variable, named with its
    // own type — the destination is not presented as its destination.
    expect(text).toContain("Converted variable: f_i32 (int32)");
  });

  it("keeps Apply enabled with no note when the cast target matches the destination type", () => {
    const projected = {
      id: 1,
      kind: "assign",
      next: null,
      var: "f",
      ty: "float64",
      expr: "{n}",
      casting: {
        anchorId: 7,
        castId: 8,
        tempName: "__aqualotus_internal_cast_1",
        destinationName: "f",
        sourceExpr: "{n}",
        targetType: "float64",
      },
    } satisfies UiCommand;
    render(<Inspector {...inspectorProps()} selected={projected} />);
    // The conversion result already has the destination's type: the
    // assign stores it directly, so no new variable is created and
    // nothing is explained.
    expect(screen.queryByTestId("cast-converted-variable")).toBeNull();
    expect(screen.queryByTestId("cast-converted-note")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);
  });

  it.each([
    ["int32", "int32"],
    ["int32", "int64"],
    ["int32", "uint8"],
    ["int64", "int64"],
    ["int64", "int32"],
    ["string", "string"],
    ["string", "int32"],
    ["int32", "uint128"],
    ["string", "uint128"],
  ] as const)(
    "accepts destination %s with cast target %s",
    (destinationType, targetType) => {
      const projected = {
        id: 1,
        kind: "assign",
        next: null,
        var: "dest",
        ty: destinationType,
        expr: "{src}",
        casting: {
          anchorId: 7,
          castId: 8,
          tempName: "__aqualotus_internal_cast_1",
          destinationName: "dest",
          sourceExpr: "{src}",
          targetType,
        },
      } satisfies UiCommand;
      render(<Inspector {...inspectorProps()} selected={projected} />);
      // Every one of the Engine's 210 directed conversions is
      // selectable: the Inspector never blocks on the target/destination
      // type pair, because a differing target creates its own variable.
      expect(
        screen.getByRole("button", { name: "Apply edit" }),
      ).toHaveProperty("disabled", false);
      // The new variable is named exactly when the target differs from
      // the declared type.
      const converted = screen.queryByTestId("cast-converted-variable");
      if (destinationType === targetType) {
        expect(converted).toBeNull();
      } else {
        expect(converted?.getAttribute("data-cast-converted-name")).toBe(
          convertedVariableName([], "dest", targetType),
        );
        expect(converted?.getAttribute("data-cast-target-type")).toBe(
          targetType,
        );
        expect(converted?.textContent).toContain(
          `(${targetType})`,
        );
      }
    },
  );

  it("treats an undeclared destination as the name source and still allows Apply", async () => {
    const user = userEvent.setup();
    render(
      <Inspector
        {...inspectorProps()}
        selected={{
          id: 1,
          kind: "assign",
          next: null,
          var: "ghost",
          expr: "{n}",
        }}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Casting" }));
    await user.selectOptions(screen.getByLabelText("Cast to type"), "int32");
    expect(screen.getByTestId("destination-unresolved").textContent).toContain(
      "type not resolved",
    );
    // The destination is only the base for the converted variable's
    // name; the apply never writes it, so an undeclared destination is
    // not an error. The note says exactly that.
    expect(screen.getByTestId("cast-converted-note").textContent).toContain(
      "The destination is not declared.",
    );
    expect(
      screen
        .getByTestId("cast-converted-variable")
        .getAttribute("data-cast-converted-name"),
    ).toBe("ghost_i32");
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);
  });

  it("revalidates when the destination's declared type changes", async () => {
    const user = userEvent.setup();
    const selected = {
      id: 1,
      kind: "assign",
      next: null,
      var: "dest",
      ty: "int32",
      expr: "{n}",
    } satisfies UiCommand;
    const commands = (ty: "int32" | "int64") => [
      {
        id: 2,
        kind: "declare" as const,
        next: null,
        var: "dest",
        ty,
        expr: "0",
      },
    ];
    const { rerender } = render(
      <Inspector
        {...inspectorProps()}
        commands={commands("int32")}
        selected={selected}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Casting" }));
    await user.selectOptions(screen.getByLabelText("Cast to type"), "int32");
    // Matching declared type: the conversion result is stored in the
    // destination, so no new variable is created.
    expect(screen.queryByTestId("cast-converted-variable")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);

    // Same draft (target int32), but the declaration now reports int64:
    // the Inspector must re-evaluate against the live declaration and
    // name the new int32 variable the apply will create.
    rerender(
      <Inspector
        {...inspectorProps()}
        commands={commands("int64")}
        selected={selected}
      />,
    );
    expect(
      screen
        .getByTestId("cast-converted-variable")
        .getAttribute("data-cast-converted-name"),
    ).toBe("dest_i32");
    expect(screen.getByTestId("cast-converted-note").textContent).toContain(
      "The destination keeps its declared type int64 and its value.",
    );
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);
  });

  it("disabling casting removes the stale target and submits an ordinary assign", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const projected = {
      id: 1,
      kind: "assign",
      next: null,
      var: "f",
      ty: "float64",
      expr: "{n}",
      casting: {
        anchorId: 7,
        castId: 8,
        tempName: "__aqualotus_internal_cast_1",
        destinationName: "f",
        sourceExpr: "{n}",
        targetType: "float64",
      },
    } satisfies UiCommand;
    render(
      <Inspector
        {...inspectorProps()}
        onReplace={onReplace}
        selected={projected}
      />,
    );
    await user.click(screen.getByLabelText(/Casting/));
    // The target menu disappears with the configuration.
    expect(screen.queryByLabelText("Cast to type")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Apply edit" }));
    const draft = onReplace.mock.calls[0]?.[1] as {
      kind: string;
      casting?: unknown;
    };
    expect(draft.kind).toBe("assign");
    expect(draft.casting).toEqual({ enabled: false, targetType: null });
  });

  it("uses the live command list to check a renamed destination", async () => {
    const user = userEvent.setup();
    render(
      <Inspector
        {...inspectorProps()}
        commands={[
          {
            id: 1,
            kind: "assign",
            next: null,
            var: "f",
            ty: "float64",
            expr: "{n}",
          },
          {
            id: 2,
            kind: "declare",
            next: null,
            var: "g",
            ty: "int32",
            expr: "0",
          },
        ]}
        selected={{
          id: 1,
          kind: "assign",
          next: null,
          var: "f",
          ty: "float64",
          expr: "{n}",
        }}
      />,
    );
    await user.click(screen.getByLabelText(/Casting/));
    await user.selectOptions(screen.getByLabelText("Cast to type"), "float64");
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "g");
    // The destination is now `g: int32`; the float64 target stays valid
    // — it creates a new float64 variable named after the destination —
    // and the Inspector re-resolves it live from the command list.
    expect(
      screen
        .getByTestId("cast-converted-variable")
        .getAttribute("data-cast-converted-name"),
    ).toBe("g_f64");
    expect(screen.getByTestId("cast-converted-note").textContent).toContain(
      "The destination keeps its declared type int32 and its value.",
    );
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);
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
