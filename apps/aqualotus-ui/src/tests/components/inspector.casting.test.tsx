import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Inspector from "../../components/Inspector";
import type { UiCommand } from "../../lib/program";
import { convertedVariableName } from "../../lib/casting";
import { inspectorProps } from "./inspector.test-helpers";

describe("Inspector casting", () => {
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
    expect(options).not.toContain("void");
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
    expect(screen.queryByLabelText("Cast to type")).toBeNull();
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
    expect(screen.getByTestId("cast-incomplete").textContent).toContain(
      "Select a target type to complete casting.",
    );
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", true);
    expect(
      (screen.getByLabelText(/Value/) as HTMLInputElement).value,
    ).toBe("{n}");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "f",
    );
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
    const text = container.textContent ?? "";
    expect(text).not.toContain("then to");
    expect(text).not.toContain("before storing");
    expect(text).not.toContain("second conversion");
    expect(screen.queryByTestId("cast-store-note")).toBeNull();
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
      expect(
        screen.getByRole("button", { name: "Apply edit" }),
      ).toHaveProperty("disabled", false);
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
        expect(converted?.textContent).toContain(`(${targetType})`);
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
    expect(screen.queryByTestId("cast-converted-variable")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Apply edit" }),
    ).toHaveProperty("disabled", false);

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
});
