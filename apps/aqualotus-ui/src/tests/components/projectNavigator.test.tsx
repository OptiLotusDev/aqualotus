import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectNavigator from "../../components/ProjectNavigator";

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
