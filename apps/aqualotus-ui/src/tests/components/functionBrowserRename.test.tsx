import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FunctionBrowser from "../../components/FunctionBrowser";

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
