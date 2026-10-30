import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BlockLibrary from "../../components/BlockLibrary";

describe("BlockLibrary", () => {
  function libraryProps(): React.ComponentProps<typeof BlockLibrary> {
    return { busy: false, onAdd: vi.fn(), onDropToCanvas: vi.fn() };
  }

  it("lists exactly the api.md blocks and adds them", async () => {
    const user = userEvent.setup();
    const props = libraryProps();
    render(<BlockLibrary {...props} />);
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
    expect(document.body.querySelector(".lib-ghost")).not.toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 80 });
    expect(document.body.querySelector(".lib-ghost")).toBeNull();
    expect(props.onDropToCanvas).not.toHaveBeenCalled();
    expect(props.onAdd).not.toHaveBeenCalled();
  });
});
