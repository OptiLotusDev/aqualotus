/**
 * Full-stack UI ↔ engine end-to-end test.
 *
 * This is the strongest evidence the audit can produce: the real
 * application (`App` → `AppShell` → `useProgram` → the bridge) is
 * rendered against the **real** Optilotus WASM artifact, and the test
 * drives it the way a user does — clicking the block library, wiring
 * the blocks and pressing Run — then asserts the output the engine
 * produced shows up in the Runner panel.
 *
 * Only the start intro is stubbed: it is a decorative CSS timeline
 * that blocks input for ~3.7 s and touches no engine code.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetRealEngine, useRealEngine } from "./test-support/realEngine";

vi.mock("./components/StartIntro", async () => {
  const { useEffect } = await import("react");
  return {
    default: function IntroStub({ onFinished }: { onFinished: () => void }) {
      // The real intro is a decorative CSS timeline that blocks input
      // for ~3.7 s. The stub reports "finished" immediately so the app
      // is interactive; it touches no engine code.
      useEffect(() => {
        onFinished();
      }, [onFinished]);
      return null;
    },
  };
});

import App from "./App";

// jsdom implements no `matchMedia`; the shell asks it for the layout.
if (typeof window !== "undefined" && window.matchMedia === undefined) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeAll(async () => {
  await useRealEngine();
});

beforeEach(() => {
  resetRealEngine();
});

/** Wait until the runtime is connected and the first projection landed. */
async function waitForReady(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Toggle blocks panel" })).toBeTruthy();
    // The projection has loaded: the editor shows `main`.
    expect(screen.getAllByText("main()").length).toBeGreaterThan(0);
  });
}

/** Open the blocks panel once. */
async function openLibrary(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Toggle blocks panel" }));
  await screen.findByRole("button", { name: "Add Print block" });
}

/** Add one library block. */
async function addBlock(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: `Add ${label} block` }));
}

describe("PARITY-022 — the whole app runs a real program", () => {
  it("builds a program in the library and shows the engine's output", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForReady();

    // Build a program: one variable, one print.
    await openLibrary(user);
    await addBlock(user, "Declare Variable");
    await addBlock(user, "Print");

    // The blocks start detached, so the first run produces nothing and
    // the runner offers the one-click wiring.
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    const connect = await screen.findByRole("button", {
      name: "Connect blocks in order",
    });
    await user.click(connect);

    // Run it again — now the chain is connected.
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));

    // The Runner shows the output the engine produced.
    await waitFor(() => {
      const output = screen.getByLabelText("Program output");
      expect(output.textContent).toContain("hello");
    });
    expect(screen.getByTestId("runner-status").getAttribute("data-state")).toBe(
      "ready",
    );
  });

  it("runs an `if` block from the library instead of failing on a dangling condition", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForReady();

    // The "If / Else" block carries a condition and a print body.
    await openLibrary(user);
    await addBlock(user, "If / Else");
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    const connect = await screen.findByRole("button", {
      name: "Connect blocks in order",
    });
    await user.click(connect);
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));

    // Regression: rewiring a block to an `if` used to orphan the
    // engine's hidden condition compute, and the run failed with
    // "missing value N at M".
    await waitFor(() => {
      expect(screen.getByTestId("runner-status").getAttribute("data-state")).toBe(
        "ready",
      );
    });
    expect(screen.queryByTestId("runner-error")).toBeNull();
  });

  it("shows the engine's typed error when the program fails", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForReady();

    // A call to a function that does not exist is a runtime error: the
    // engine reports `UnknownFunction` and names the callee.
    await openLibrary(user);
    await addBlock(user, "Declare Variable");
    await addBlock(user, "Call Function");
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    const connect = await screen.findByRole("button", {
      name: "Connect blocks in order",
    });
    await user.click(connect);
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));

    await waitFor(() => {
      expect(screen.getByTestId("runner-error")).toBeTruthy();
    });
    // The engine's own words, not a UI invention.
    expect(screen.getByTestId("runner-error").textContent).toContain(
      "UnknownFunction",
    );
    expect(screen.getByTestId("runner-error").textContent).toContain("helper");
  });
});
