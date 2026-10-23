/**
 * Branch-frame geometry against the real engine and the real app
 * (regression for the Task 2 investigation): TRUE/ELSE branch frames
 * are unions of the *visible* member rects the layout placed — hidden
 * anchors are intentionally not part of a frame's size.
 *
 * - three print members appended by drag gestures end up inside the
 *   TRUE frame (the union grows with every member);
 * - a casting assignment member (its hidden two-leg group behind one
 *   visible block) is enclosed by the single-member frame, and a later
 *   print widens it into a union enclosing both; the run still works
 *   because the append heals the `if`'s condition compute.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetRealEngine, useRealEngine } from "../test-support/realEngine";
import { optilotus_listCommands } from "../lib/optilotus";
import App from "../App";

vi.mock("../components/StartIntro", async () => {
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
    expect(screen.getByRole("button", { name: "Toggle blocks panel" })).toBeTruthy();
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

/** Drag a wire from `port` onto the TRUE branch lane, like the gesture. */
function dragWire(port: HTMLElement, container: HTMLElement): void {
  stubElementsFromPoint([
    container.querySelector('.vbranch[data-fid="0"][data-if-branch="then"]'),
  ]);
  fireEvent.pointerDown(port, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
  fireEvent.pointerMove(board(container), { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(board(container), { pointerId: 1, clientX: 10, clientY: 10 });
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
}

/** The engine's own branch state: the `if` row's THEN body and prints. */
function engineThen(): { ifId: number; then: number[] } {
  const listed = optilotus_listCommands(0);
  if (listed.status !== "ok") throw new Error("list failed");
  const ifCmd = listed.commands.find((c) => c.kind === "if");
  return { ifId: ifCmd?.id ?? -1, then: ifCmd?.then_body ?? [] };
}

function frameRect(
  container: HTMLElement,
): { x: number; y: number; w: number; h: number } {
  const frame = container.querySelector(
    '.vbranch[data-fid="0"][data-if-branch="then"]',
  ) as HTMLElement;
  if (frame === null) throw new Error("TRUE frame not rendered");
  return {
    x: Number(frame.style.left.replace("px", "")),
    y: Number(frame.style.top.replace("px", "")),
    w: Number(frame.style.width.replace("px", "")),
    h: Number(frame.style.height.replace("px", "")),
  };
}

function memberRect(
  container: HTMLElement,
  id: number,
): { x: number; y: number; w: number; h: number } {
  const el = container.querySelector(
    `.vblock[data-fid="0"][data-block-id="${id}"]`,
  ) as HTMLElement | null;
  if (el === null) throw new Error(`member ${id} not rendered`);
  return {
    x: Number(el.style.left.replace("px", "")),
    y: Number(el.style.top.replace("px", "")),
    w: 216,
    h: 104,
  };
}

describe("branch frames enclose their visible members (engine truth)", () => {
  it("keeps the TRUE frame covering every member after three appends", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await waitForReady();

    // Build: declare, if, three prints.
    await user.click(screen.getByRole("button", { name: "Toggle blocks panel" }));
    await screen.findByRole("button", { name: "Add Print block" });
    for (const label of ["Declare Variable", "If / Else", "Print", "Print", "Print"]) {
      await user.click(screen.getByRole("button", { name: `Add ${label} block` }));
    }

    // Chain in order like the notice suggests.
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    await user.click(
      await screen.findByRole("button", { name: "Connect blocks in order" }),
    );

    const container = view.container;
    const printIds: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      const before = engineThen();
      // Pick the first print block that is still parked on the auto row.
      const blockEls = [
        ...container.querySelectorAll('.vblock[data-fid="0"][data-kind="print"]'),
      ].filter((b) => (b as HTMLElement).style.top === "36px");
      const el = blockEls[0] as HTMLElement | undefined;
      if (el === undefined) throw new Error(`no orphan print for step ${i + 1}`);
      const port = el.querySelector('[data-port="out"]') as HTMLElement;
      const bid = Number(el.dataset.blockId);
      printIds.push(bid);
      // The block must still be on the main chain before the wire.
      expect(before.then).not.toContain(bid);
      dragWire(port, container);

      // The projection lands: the engine lists the member in the branch.
      await waitFor(() => {
        expect(engineThen().then).toContain(bid);
      });
      // placeBranchMember gave it a column spot (its top moves below y=36).
      const member = container.querySelector(
        `.vblock[data-fid="0"][data-block-id="${bid}"]`,
      ) as HTMLElement | null;
      if (member === null) throw new Error(`member ${bid} not rendered`);
    }

    // Assert: every TRUE member sits inside the frame rect.
    const frame = frameRect(container);
    expect(frame.h).toBeGreaterThan(300);
    for (const id of printIds) {
      const rect = memberRect(container, id);
      expect(rect.x).toBeGreaterThanOrEqual(frame.x);
      expect(rect.y).toBeGreaterThanOrEqual(frame.y);
      expect(rect.x + rect.w).toBeLessThanOrEqual(frame.x + frame.w);
      expect(rect.y + rect.h).toBeLessThanOrEqual(frame.y + frame.h);
    }
  });

  it("encloses a cast member, then the cast+print union", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await waitForReady();

    // Build: declare x = 5, if, print (join candidate).
    await user.click(screen.getByRole("button", { name: "Toggle blocks panel" }));
    await screen.findByRole("button", { name: "Add Print block" });
    for (const label of ["Declare Variable", "If / Else", "Print"]) {
      await user.click(screen.getByRole("button", { name: `Add ${label} block` }));
    }
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    await user.click(
      await screen.findByRole("button", { name: "Connect blocks in order" }),
    );

    const container = view.container;

    // Add an Assign block (adding selects it; the friendly default
    // targets the declared `x`) and convert it through the Inspector:
    // value 5, casting → int64. The destination is declared int32, so
    // the chosen target creates a NEW converted variable (`x_i64`) —
    // the original declaration is never rewritten, and the visible
    // block becomes the Engine cast that declares it.
    await user.click(screen.getByRole("button", { name: "Add Assign Variable block" }));
    await user.click(await screen.findByRole("button", { name: "Toggle inspector" }));
    const castingToggle = await screen.findByRole("checkbox", { name: "Casting" });
    await user.click(castingToggle);
    const valueField = screen.getByLabelText("Value") as HTMLInputElement;
    await user.clear(valueField);
    await user.type(valueField, "5");
    await user.selectOptions(screen.getByLabelText("Cast to type"), "int64");
    await user.click(screen.getByRole("button", { name: "Apply edit" }));

    // The converted variable is a real cast row of the target type; the
    // original `x` keeps its int32 declaration and its value, and only
    // the hidden anchor sits behind the visible block.
    const castId = await waitFor(() => {
      const listed = optilotus_listCommands(0);
      if (listed.status !== "ok") throw new Error("list failed");
      const row = listed.commands.find(
        (c) => c.kind === "cast" && (c.var ?? "") === "x_i64",
      );
      if (row === undefined) throw new Error("converted variable not created");
      expect(row.ty).toBe("int64");
      expect(
        listed.commands.find(
          (c) => c.kind === "declare" && (c.var ?? "") === "x",
        )?.ty,
      ).toBe("int32");
      expect(
        listed.commands.filter((c) =>
          (c.var ?? "").startsWith("__aqualotus_internal_"),
        ),
      ).toHaveLength(1);
      // No conversion back into the destination's declared type exists.
      expect(
        listed.commands.some((c) => c.kind === "cast" && c.ty === "int32"),
      ).toBe(false);
      return row.id;
    });

    // Drop the converted variable into the TRUE branch by gesture.
    await waitFor(() => {
      expect(
        container.querySelector(`.vblock[data-fid="0"][data-block-id="${castId}"]`),
      ).not.toBeNull();
    });
    const castEl = container.querySelector(
      `.vblock[data-fid="0"][data-block-id="${castId}"]`,
    ) as HTMLElement;
    const port = castEl.querySelector('[data-port="out"]') as HTMLElement;
    dragWire(port, container);
    await waitFor(() => {
      // `if_append` moves the whole hidden group; the branch list
      // records the raw ids of every member — the visible assign among
      // them, so the frame geometry below has one id to check.
      expect(engineThen().then).toContain(castId);
    });

    // The frame must enclose the member's rendered rect and the run
    // must still work (the condition-compute heal runs on append).
    await user.click(screen.getByTitle("Run (Ctrl/Cmd + Enter)"));
    const frame1 = frameRect(container);
    const cast = memberRect(container, castId);
    expect(cast.x).toBeGreaterThanOrEqual(frame1.x);
    expect(cast.y).toBeGreaterThanOrEqual(frame1.y);
    expect(cast.x + cast.w).toBeLessThanOrEqual(frame1.x + frame1.w);
    expect(cast.y + cast.h).toBeLessThanOrEqual(frame1.y + frame1.h);

    // Append a print as a second member: the frame union still encloses
    // both (the cast's hidden anchor never widens the frame).
    await user.click(screen.getByRole("button", { name: "Add Print block" }));
    await waitFor(() => {
      const orphans = [
        ...container.querySelectorAll('.vblock[data-fid="0"][data-kind="print"]'),
      ].filter((b) => (b as HTMLElement).style.top === "36px");
      expect(orphans.length).toBeGreaterThan(0);
    });
    const orphan = [
      ...container.querySelectorAll('.vblock[data-fid="0"][data-kind="print"]'),
    ].filter((b) => (b as HTMLElement).style.top === "36px")[0] as HTMLElement;
    const orphanId = Number(orphan.dataset.blockId);
    const orphanPort = orphan.querySelector('[data-port="out"]') as HTMLElement;
    dragWire(orphanPort, container);
    await waitFor(() => {
      expect(engineThen().then).toContain(orphanId);
    });

    const frame2 = frameRect(container);
    for (const id of [castId, orphanId]) {
      const rect = memberRect(container, id);
      expect(rect.x).toBeGreaterThanOrEqual(frame2.x);
      expect(rect.y).toBeGreaterThanOrEqual(frame2.y);
      expect(rect.x + rect.w).toBeLessThanOrEqual(frame2.x + frame2.w);
      expect(rect.y + rect.h).toBeLessThanOrEqual(frame2.y + frame2.h);
    }
  });
});
