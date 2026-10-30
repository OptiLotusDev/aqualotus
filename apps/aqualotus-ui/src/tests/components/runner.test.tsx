import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Runner from "../../components/Runner";

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
    expect(panel.textContent ?? "").toContain("UnknownVariable");
    expect(panel.textContent ?? "").toContain('unknown variable "ghost" at 3');
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
    expect(screen.getByTestId("runner-error")).toBeDefined();
    expect(screen.getByTestId("runner-error").textContent ?? "").toContain(
      "TypeMismatch",
    );
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
