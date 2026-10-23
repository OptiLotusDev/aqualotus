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
import { optilotus_listCommands } from "./lib/optilotus";

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

  it("keeps the Casting annotation on the real assign through undo, redo and delete", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitForReady();

    // Declare `x: int32`, then add the Assign Variable block. Adding a
    // block selects it, so the Inspector button opens its properties.
    await openLibrary(user);
    await addBlock(user, "Declare Variable");
    await addBlock(user, "Assign Variable");
    await user.click(
      screen.getByRole("button", { name: "Toggle inspector" }),
    );
    const toggle = await screen.findByRole("checkbox", { name: "Casting" });
    await user.click(toggle);
    await user.selectOptions(screen.getByLabelText("Cast to type"), "int32");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    // The real Engine holds the hidden conversion group, and the
    // visible Assign block carries the annotation.
    const annotation = await screen.findByTestId(/^casting-enabled-/);
    const assign = annotation.closest(".vblock");
    expect(assign).not.toBeNull();
    expect(assign?.getAttribute("data-kind")).toBe("assign");
    expect(annotation.getAttribute("data-casting-target")).toBe("int32");
    expect(
      screen.getByRole("button", { name: /assign block 2 in main/ }),
    ).toBe(assign);

    const undo = screen.getAllByRole("button", {
      name: "Undo Edit assign",
    })[0];
    expect(undo).toBeDefined();
    if (undo === undefined) return;
    await user.click(undo);
    await waitFor(() => {
      expect(screen.queryByTestId(/^casting-enabled-/)).toBeNull();
    });

    const redo = screen.getAllByRole("button", {
      name: "Redo Edit assign",
    })[0];
    expect(redo).toBeDefined();
    if (redo === undefined) return;
    await user.click(redo);
    const restored = await screen.findByTestId(/^casting-enabled-/);
    expect(restored.getAttribute("data-casting-target")).toBe("int32");

    await user.click(screen.getByRole("button", { name: "Delete Block" }));
    await waitFor(() => {
      expect(screen.queryByTestId(/^casting-enabled-/)).toBeNull();
    });
  });

  /**
   * Option B, driven the way a user drives it: the converted value is a
   * real, separate program variable, the original variable and its
   * assignment are untouched, and the run prints both.
   */
  it("creates a converted variable from an assignment and runs it", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await waitForReady();
    await openLibrary(user);

    // 1. Create and assign the source variable: `x : int32 = 5`, then
    //    the ordinary assignment `x = 5`.
    await addBlock(user, "Declare Variable");
    await user.click(screen.getByRole("button", { name: "Toggle inspector" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "x");
    await user.selectOptions(screen.getByLabelText("Type"), "int32");
    await user.clear(screen.getByLabelText("Value (optional)"));
    await user.type(screen.getByLabelText("Value (optional)"), "5");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    await addBlock(user, "Assign Variable");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "x");
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "5");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    // 2./3. A second assignment reads `x` and asks for a float64
    //    conversion: the chosen target differs from the declared type,
    //    so applying creates the converted variable instead of writing
    //    the destination.
    await addBlock(user, "Assign Variable");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "x");
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "{{x}");
    await user.click(screen.getByRole("checkbox", { name: "Casting" }));
    await user.selectOptions(screen.getByLabelText("Cast to type"), "float64");
    // The Inspector names the new variable and its type before applying.
    expect(
      screen
        .getByTestId("cast-converted-variable")
        .getAttribute("data-cast-converted-name"),
    ).toBe("x_f64");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    // 4. The converted variable is a visible block of the target type.
    const annotation = await screen.findByTestId(/^casting-enabled-/);
    const convertedBlock = annotation.closest(".vblock");
    expect(convertedBlock?.getAttribute("data-kind")).toBe("cast");
    expect(annotation.getAttribute("data-casting-target")).toBe("float64");

    // 5. Downstream blocks read the new variable (and the original).
    await addBlock(user, "Print");
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "{{x_f64}");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));
    await addBlock(user, "Print");
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "{{x}");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    // 6. Wire and execute the real program.
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    await user.click(
      await screen.findByRole("button", { name: "Connect blocks in order" }),
    );
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));

    // 7. The engine's own output: the converted float64 prints 5.0, the
    //    original int32 still prints 5.
    await waitFor(() => {
      expect(screen.getByLabelText("Program output").textContent).toBe(
        "> 5.0\n> 5",
      );
    });

    // 8. The original variable and its assignment are unchanged, and the
    //    program holds exactly one conversion — the user's float64 one.
    const listed = optilotus_listCommands(0);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(
      listed.commands.find((c) => c.kind === "declare" && c.var === "x"),
    ).toMatchObject({ ty: "int32", expr: "5" });
    expect(
      listed.commands.filter((c) => c.kind === "assign" && c.var === "x"),
    ).toHaveLength(1);
    expect(
      listed.commands.find((c) => c.kind === "assign" && c.var === "x")?.expr,
    ).toBe("5");
    const casts = listed.commands.filter((c) => c.kind === "cast");
    expect(casts).toHaveLength(1);
    expect(casts[0]).toMatchObject({ var: "x_f64", ty: "float64", expr: "{x}" });
    expect(
      listed.commands.some((c) => c.kind === "cast" && c.ty === "int32"),
    ).toBe(false);

    // Changing the target type after a conversion replaces the converted
    // variable: the old declaration is gone (no stale reference) and the
    // original variable is still the user's int32 holding 5.
    await user.click(convertedBlock as HTMLElement);
    await user.selectOptions(screen.getByLabelText("Cast to type"), "uint128");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    await waitFor(() => {
      const after = optilotus_listCommands(0);
      expect(after.status).toBe("ok");
      if (after.status !== "ok") return;
      expect(
        after.commands.find((c) => c.kind === "cast" && c.var === "x_u128"),
      ).toMatchObject({ ty: "uint128" });
      // No duplicate or stale converted variable remains.
      expect(
        after.commands.some((c) => (c.var ?? "") === "x_f64"),
      ).toBe(false);
      expect(after.commands.filter((c) => c.kind === "cast")).toHaveLength(1);
      expect(
        after.commands.find((c) => c.kind === "declare" && c.var === "x"),
      ).toMatchObject({ ty: "int32", expr: "5" });
      expect(
        after.commands.filter((c) => c.kind === "assign" && c.var === "x"),
      ).toHaveLength(1);
    });
    // The user's own print still names the old variable: the engine
    // reports it instead of the UI printing a stale converted value.
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    await waitFor(() => {
      expect(screen.getByTestId("runner-error")).toBeTruthy();
    });
    expect(screen.getByTestId("runner-error").textContent).toContain(
      "UnknownVariable",
    );
    expect(view.container.querySelectorAll(".vblock").length).toBeGreaterThan(0);
  });
});
