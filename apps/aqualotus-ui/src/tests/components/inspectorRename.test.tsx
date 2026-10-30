import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Inspector from "../../components/Inspector";

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
