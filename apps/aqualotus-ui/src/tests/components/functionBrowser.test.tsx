import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FunctionBrowser from "../../components/FunctionBrowser";
import { EXIT_MS } from "../../hooks/useExitItems";

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
    await user.click(screen.getByRole("button", { name: "Rename helper" }));
    const input = screen.getByLabelText("New function name");
    await user.clear(input);
    await user.type(input, "worker");
    await user.click(screen.getByRole("button", { name: "✓" }));
    expect(onRename).toHaveBeenCalledWith(1, "worker");

    onRename.mockClear();
    await user.click(screen.getByRole("button", { name: "Rename helper" }));
    await user.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("helper")).toBeDefined();

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
