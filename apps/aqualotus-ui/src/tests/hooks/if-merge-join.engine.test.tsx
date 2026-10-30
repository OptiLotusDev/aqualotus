/**
 * The manual "End of If Block" join against the **real** engine through
 * the real app (regression for the If/Else connection-join task): the
 * pill is presentation, but what it draws — and what disappears when it
 * goes away — must match what the engine really holds.
 *
 * - toggling the merge on draws one rail per TRUE/FALSE branch into the
 *   circle even with no continuation block under the `if` (the empty
 *   branches feed it from the card's own ports), and no wire carries
 *   anything past the circle;
 * - "Unmerge branches" is atomic on real engine state: the circle and
 *   every merge-class wire vanish in one action while the engine's
 *   `if.next` detaches — the flow stops at the `if` and the ex-contin
 *   uation print never runs again;
 * - a wire pulled from the circle's own out-port drops through the
 *   ordinary planners with the wire's source = the `if`, so the engine
 *   persists `if.next` and the drawn continuation leaves the circle
 *   (never the card, which has no right port at all).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetRealEngine, useRealEngine } from "../../test-support/realEngine";
import {
  optilotus_listCommands,
  optilotus_runProgram,
} from "../../lib/optilotus";import App from "../../App";

vi.mock("../../components/StartIntro", async () => {
  const { useEffect } = await import("react");
  return {
    default: function IntroStub({ onFinished }: { onFinished: () => void }) {
      useEffect(() => {
        onFinished();
      }, [onFinished]);
      return null;
    },
  };
});

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

async function waitForReady(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Toggle blocks panel" }),
    ).toBeTruthy();
  });
}

function board(container: HTMLElement): HTMLElement {
  return container.querySelector("#board") as HTMLElement;
}

function stubElementsFromPoint(elements: (Element | null)[]): void {
  Object.defineProperty(document, "elementsFromPoint", {
    value: () => elements,
    configurable: true,
    writable: true,
  });
}

/** Select a block with the canvas gesture (pointer down, no move). */
function clickBlock(el: Element, container: HTMLElement): void {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    button: 0,
  });
  fireEvent.pointerUp(board(container), {
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });
}

/** One full connection gesture: grab the out-port, stretch the wire,
 * release it over the board (drop hit comes from the stub). */
function dragWire(port: HTMLElement, container: HTMLElement): void {
  fireEvent.pointerDown(port, {
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    button: 0,
  });
  fireEvent.pointerMove(board(container), {
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerUp(board(container), {
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });
}

/** Block the canvas renders for a command id in main. */
function blockEl(
  container: HTMLElement,
  kind: string,
): HTMLElement {
  const el = container.querySelector(
    `.vblock[data-fid="0"][data-kind="${kind}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`${kind} block not rendered`);
  }
  return el;
}

/** The engine's own `if` row: id, continuation link, branch lists. */
function engineIf(): {
  ifId: number;
  next: number | null;
  thenBody: number[];
  elseBody: number[];
} {
  const listed = optilotus_listCommands(0);
  if (listed.status !== "ok") throw new Error("list failed");
  const cmd = listed.commands.find((c) => c.kind === "if");
  return {
    ifId: cmd?.id ?? -1,
    next: cmd?.next ?? null,
    thenBody: cmd?.then_body ?? [],
    elseBody: cmd?.else_body ?? [],
  };
}

/** The engine's own successor pointer of one command. */
function engineNext(id: number): number | null {
  const listed = optilotus_listCommands(0);
  if (listed.status !== "ok") throw new Error("list failed");
  const cmd = listed.commands.find((c) => c.id === id);
  if (cmd === undefined) throw new Error(`command ${id} missing`);
  return cmd.next ?? null;
}

/** The program's own run, loudly failing on a broken envelope. */
function runPrints(): string[] {
  const run = optilotus_runProgram();
  if (run.status !== "ok") {
    throw new Error(`run failed: ${JSON.stringify(run)}`);
  }
  return [...run.printed];
}

/**
 * Build the standard canvas: declare, if, one print — added by panel
 * clicks, nothing wired yet.
 */
async function buildCanvas(
  user: ReturnType<typeof userEvent.setup>,
  view: { container: HTMLElement },
): Promise<{ ifId: number; declareId: number; printId: number }> {
  await user.click(
    screen.getByRole("button", { name: "Toggle blocks panel" }),
  );
  await screen.findByRole("button", { name: "Add Print block" });
  for (const label of ["Declare Variable", "If / Else", "Print"]) {
    await user.click(
      screen.getByRole("button", { name: `Add ${label} block` }),
    );
  }
  const container = view.container;
  await waitFor(() => {
    expect(container.querySelector('.vblock[data-fid="0"][data-kind="if"]')).not.toBeNull();
  });
  const declareId = Number(blockEl(container, "declare").dataset.blockId);
  const ifId = Number(blockEl(container, "if").dataset.blockId);
  const printId = Number(blockEl(container, "print").dataset.blockId);
  expect(declareId).toBeGreaterThan(0);
  expect(ifId).toBeGreaterThan(0);
  expect(printId).toBeGreaterThan(0);
  return { ifId, declareId, printId };
}

describe("If/Else manual merge join (real engine, real app)", () => {
  it("draws the circle and both empty rails with no continuation under it", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await waitForReady();
    const container = view.container;
    const built = await buildCanvas(user, view);

    // Wire the declare into the `if` (a body drop): the engine's hidden
    // condition compute blocks the reported link, so the canvas carries
    // it as the planned overlay the app records.
    const ifEl = blockEl(container, "if");
    stubElementsFromPoint([ifEl]);
    const declarePort = blockEl(container, "declare").querySelector(
      '[data-port="out"]',
    );
    expect(declarePort).not.toBeNull();
    dragWire(declarePort as HTMLElement, container);
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    await waitFor(() => {
      expect(
        container.querySelector(
          `#links path.edge-planned[data-fid="0"][data-from="${built.declareId}"][data-to="${built.ifId}"]`,
        ),
      ).not.toBeNull();
    });

    // Select the `if` and switch the manual merge on (the inspector
    // opens with the selection; the toggle is presentation only).
    clickBlock(ifEl, container);
    await screen.findByTestId(`merge-controls-${built.ifId}`);
    const toggle = screen.getByTestId("merge-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(toggle);

    // The circle appears and names the `if`...
    await waitFor(() => {
      expect(
        container.querySelector(`.vjoin[data-join-of="${built.ifId}"]`),
      ).not.toBeNull();
    });
    const join = container.querySelector(
      `.vjoin[data-join-of="${built.ifId}"]`,
    ) as HTMLElement;
    expect(join.querySelector('.vport[data-port="in"]')).not.toBeNull();
    const out = join.querySelector('[data-port="out"]');
    expect(out?.getAttribute("data-block-id")).toBe(String(built.ifId));

    // ...both branches address it (empty branches: one rail per card
    // port, drawn card → circle)...
    const rails = container.querySelectorAll(
      `#links path.edge-merge[data-fid="0"][data-from="${built.ifId}"][data-to="${built.ifId}"]`,
    );
    expect(rails.length).toBe(2);

    // ...and nothing carries the flow past the circle: the orphan print
    // stays unwired by engine truth, and no merge wire points at it.
    expect(engineIf().next).toBeNull();
    expect(engineIf().thenBody).toEqual([]);
    expect(engineIf().elseBody).toEqual([]);
    expect(engineNext(built.printId)).toBeNull();
    expect(
      container.querySelectorAll(
        `#links path.edge-merge[data-fid="0"][data-to="${built.printId}"]`,
      ).length,
    ).toBe(0);
  });

  it("unmerge removes the circle and every merge wire, detaching the continuation", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await waitForReady();
    const container = view.container;
    const built = await buildCanvas(user, view);

    // One-click wiring: declare → if → print, entry at the declare.
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    await user.click(
      await screen.findByRole("button", { name: "Connect blocks in order" }),
    );
    await waitFor(() => {
      expect(engineNext(built.ifId)).toBe(built.printId);
    });
    // The wired chain runs (the panel's default print template is
    // "hello"): the continuation is reachable through the `if`.
    expect(runPrints()).toEqual(["hello"]);

    // Select the `if` and merge on: the circle feeds the continuation.
    const ifEl = blockEl(container, "if");
    clickBlock(ifEl, container);
    await screen.findByTestId(`merge-controls-${built.ifId}`);
    await user.click(screen.getByTestId("merge-toggle"));
    await waitFor(() => {
      expect(
        container.querySelector(
          `#links path.edge-merge[data-fid="0"][data-from="${built.ifId}"][data-to="${built.printId}"]`,
        ),
      ).not.toBeNull();
    });
    expect(
      container.querySelector(`.vjoin[data-join-of="${built.ifId}"]`),
    ).not.toBeNull();

    // The second click is the atomic "Unmerge branches": presentation
    // (circle) and engine (the `if`'s continuation link) move together.
    await user.click(screen.getByTestId("merge-toggle"));

    // The pill is gone...
    await waitFor(() => {
      expect(container.querySelectorAll(".vjoin").length).toBe(0);
    });
    // ...every merge-class wire is gone (the rails did not survive the
    // circle they pointed at — no dead arrows into empty space)...
    const merges = [
      ...container.querySelectorAll('#links path.edge-merge[data-fid="0"]'),
    ];
    expect(merges.length).toBe(0);
    // ...and no drawn wire leaves the card at all (the card has no
    // right port: the continuation that used to leave the circle was
    // drawn from the circle, and the circle is gone)...
    expect(
      container.querySelectorAll(
        `#links path[data-fid="0"][data-from="${built.ifId}"][data-to="${built.printId}"]`,
      ).length,
    ).toBe(0);

    // ...the engine's own truth is detached, and the run proves it: the
    // flow stops after the `if`, the ex-continuation prints nothing
    // (it stays on canvas as a re-wirable orphan).
    expect(engineNext(built.ifId)).toBeNull();
    expect(engineNext(built.printId)).toBeNull();
    expect(runPrints()).toEqual([]);

    // The block the merge used to carry the flow into is still
    // rendered — an orphan, not deleted.
    expect(
      container.querySelector(
        `.vblock[data-fid="0"][data-block-id="${built.printId}"]`,
      ),
    ).not.toBeNull();
  });

  it("wires the continuation from the join circle's own out-port", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await waitForReady();
    const container = view.container;
    const built = await buildCanvas(user, view);

    // Wire declare → if, keep the print orphaned.
    const ifEl = blockEl(container, "if");
    stubElementsFromPoint([ifEl]);
    const declarePort = blockEl(container, "declare").querySelector(
      '[data-port="out"]',
    );
    expect(declarePort).not.toBeNull();
    dragWire(declarePort as HTMLElement, container);
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    await waitFor(() => {
      expect(
        container.querySelector(
          `#links path.edge-planned[data-fid="0"][data-from="${built.declareId}"][data-to="${built.ifId}"]`,
        ),
      ).not.toBeNull();
    });

    // Select the `if`, merge on.
    clickBlock(ifEl, container);
    await screen.findByTestId(`merge-controls-${built.ifId}`);
    await user.click(screen.getByTestId("merge-toggle"));
    await waitFor(() => {
      expect(
        container.querySelector(`.vjoin[data-join-of="${built.ifId}"]`),
      ).not.toBeNull();
    });
    const join = container.querySelector(
      `.vjoin[data-join-of="${built.ifId}"]`,
    ) as HTMLElement;
    const outPort = join.querySelector('[data-port="out"]');
    expect(outPort).not.toBeNull();

    // The print is still an engine orphan before the wire.
    expect(engineNext(built.printId)).toBeNull();

    // Pull a wire from the circle's out-port and drop it on the print.
    stubElementsFromPoint([blockEl(container, "print")]);
    dragWire(outPort as HTMLElement, container);
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;

    // The drop resolved through the ordinary planners with the wire's
    // source = the `if`: the engine persists `if.next` = the print...
    await waitFor(() => {
      expect(engineNext(built.ifId)).toBe(built.printId);
    });
    // ...and the drawn continuation leaves the circle (merge-class,
    // unplanned), not the card: the `if` carries no right port at all.
    const jo = container.querySelector(
      `#links path.edge-merge[data-fid="0"][data-from="${built.ifId}"][data-to="${built.printId}"]`,
    );
    expect(jo).not.toBeNull();
    expect(jo?.classList.contains("edge-planned")).toBe(false);

    // The whole chain runs: the branch flow reaches the ex-continuation
    // (the panel's default print template is "hello") through the
    // circle the user wired it from.
    expect(runPrints()).toEqual(["hello"]);
  });
});
