import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import FlowTravel from "../../components/FlowTravel";

/**
 * The travelling indicator (OptiLotus design guide: "a dot travels each
 * link in order"). The tests drive the animation frames by hand, so
 * every assertion is deterministic — no real-time waits.
 */

const LINK_MS = 300;
/** The stubbed path model: a straight path of 100 units. */
const PATH_LEN = 100;

interface HarnessProps {
  readonly edges: { key: string; selected: boolean; pause?: boolean }[];
  readonly paths: ReadonlyMap<string, SVGPathElement>;
  readonly linkMs?: number;
  readonly runId?: number;
  readonly reduced?: boolean;
  /** The key of the paused connection (`null` while nothing waits). */
  readonly pauseKey?: string | null;
}

/** A connection path the indicator can ride. */
function makePath(): SVGPathElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", `M 0 0 C 50 0, 50 0, ${PATH_LEN} 0`);
  return el;
}

/** The connection paths of the given keys. */
function pathsOf(keys: readonly string[]): Map<string, SVGPathElement> {
  return new Map(keys.map((key) => [key, makePath()]));
}

/** The indicator of the given connections. */
function Harness(props: HarnessProps): ReactElement {
  const {
    edges,
    paths,
    linkMs = LINK_MS,
    runId = 1,
    reduced = false,
    pauseKey = null,
  } = props;
  return (
    <svg>
      <FlowTravel
        edges={edges}
        paths={paths}
        linkMs={linkMs}
        runId={runId}
        reduced={reduced}
        pauseKey={pauseKey}
      />
    </svg>
  );
}

/** Run the animation frames for `ms` milliseconds. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The head of the indicator of the connection at `index`. */
function head(container: HTMLElement, index: number): SVGCircleElement {
  const dot = container.querySelectorAll("circle.flow-dot")[index];
  if (dot === undefined) throw new Error("no indicator");
  return dot as SVGCircleElement;
}

function getOpacity(dot: SVGCircleElement): string {
  return dot.style.opacity || dot.getAttribute("opacity") || "0";
}

describe("FlowTravel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("travels the connection from its source to its destination", () => {
    const { container } = render(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={pathsOf(["e1"])}
      />,
    );
    const dot = head(container, 0);

    // The indicator starts at the beginning of the path.
    advance(16);
    expect(getOpacity(dot)).toBe("1");
    expect(Number(dot.getAttribute("cx"))).toBeLessThan(PATH_LEN / 2);

    // Halfway through the link it is halfway along the path.
    advance(LINK_MS / 2);
    const middle = Number(dot.getAttribute("cx"));
    expect(middle).toBeGreaterThan(PATH_LEN / 4);
    expect(middle).toBeLessThan((PATH_LEN * 3) / 4);

    // Directional: it keeps moving towards the destination.
    advance(LINK_MS / 4);
    expect(Number(dot.getAttribute("cx"))).toBeGreaterThan(middle);
  });

  it("disappears when the link is travelled", () => {
    const { container } = render(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={pathsOf(["e1"])}
      />,
    );
    const dot = head(container, 0);
    advance(LINK_MS + 100);
    expect(getOpacity(dot)).toBe("0");
  });

  it("travels the links one after another, in order", () => {
    const { container } = render(
      <Harness
        edges={[
          { key: "e1", selected: false },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
      />,
    );
    const first = head(container, 0);
    const second = head(container, 1);

    // The second link waits for the first one.
    advance(LINK_MS / 2);
    expect(getOpacity(first)).toBe("1");
    expect(getOpacity(second)).toBe("0");

    // Now the second link travels.
    advance(LINK_MS / 2 + 32);
    expect(getOpacity(first)).toBe("0");
    expect(getOpacity(second)).toBe("1");
    expect(Number(second.getAttribute("cx"))).toBeGreaterThan(0);
  });

  it("renders a solid white dot for each connection", () => {
    const { container } = render(
      <Harness
        edges={[
          { key: "e1", selected: false },
          { key: "e2", selected: true },
        ]}
        paths={pathsOf(["e1", "e2"])}
      />,
    );
    // Both connections get a simple white dot, no trail, no selected class.
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(2);
    expect(container.querySelectorAll("circle.flow-trail").length).toBe(0);
    expect(head(container, 0).getAttribute("fill")).toBe("#ffffff");
    expect(head(container, 1).getAttribute("fill")).toBe("#ffffff");
  });

  it("drops the travel under reduced motion", () => {
    const { container } = render(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={pathsOf(["e1"])}
        reduced={true}
      />,
    );
    const dot = head(container, 0);
    advance(LINK_MS * 2);
    // Nothing moves: the fades stay, the travel goes.
    expect(getOpacity(dot)).toBe("0");
    expect(dot.getAttribute("cx")).toBeNull();
  });

  it("cleans up its animation frames when it unmounts", () => {
    const { unmount } = render(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={pathsOf(["e1"])}
      />,
    );
    advance(32);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing without connections", () => {
    const { container } = render(<Harness edges={[]} paths={pathsOf([])} />);
    advance(LINK_MS * 2);
    expect(container.querySelectorAll("circle.flow-dot").length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts the travel on a new run", () => {
    const { container, rerender } = render(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={pathsOf(["e1"])}
        runId={1}
      />,
    );
    advance(LINK_MS / 2);
    const dot = head(container, 0);
    expect(getOpacity(dot)).toBe("1");

    // A new run starts the travel from the beginning again.
    rerender(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={pathsOf(["e1"])}
        runId={2}
      />,
    );
    advance(16);
    expect(Number(dot.getAttribute("cx"))).toBeLessThan(PATH_LEN / 2);
    expect(getOpacity(dot)).toBe("1");
  });

  it("leaves the connection itself untouched", () => {
    const paths = pathsOf(["e1"]);
    const path = paths.get("e1");
    const { container } = render(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={paths}
      />,
    );
    const before = path?.getAttribute("d");
    advance(LINK_MS);
    // The connection keeps its geometry and its styling: the indicator
    // is drawn beside it, never over it.
    expect(path?.getAttribute("d")).toBe(before);
    expect(path?.getAttribute("stroke")).toBeNull();
    expect(path?.getAttribute("stroke-width")).toBeNull();
    expect(container.querySelectorAll("path").length).toBe(0);
  });

  it("holds at the paused connection's end while the run waits for input", () => {
    const { container } = render(
      <Harness
        edges={[
          { key: "e1", selected: false, pause: true },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        pauseKey="e1"
      />,
    );
    const held = head(container, 0);
    const later = head(container, 1);
    // The connection travels until its end…
    advance(LINK_MS / 2);
    expect(getOpacity(held)).toBe("1");
    // …and the indicator stops there — the input block's entry side —
    // however many frames pass while the run waits.
    advance(LINK_MS * 3);
    expect(getOpacity(held)).toBe("1");
    expect(Number(held.getAttribute("cx"))).toBe(PATH_LEN);
    // Nothing past the input moves while the run waits.
    expect(getOpacity(later)).toBe("0");
    expect(Number(later.getAttribute("cx") ?? "0")).toBe(0);
    // Still there, unmoved, after waiting longer still.
    advance(LINK_MS * 4);
    expect(getOpacity(held)).toBe("1");
    expect(Number(held.getAttribute("cx"))).toBe(PATH_LEN);
  });

  it("resumes from the hold: the next connection travels without a restart", () => {
    const { container, rerender } = render(
      <Harness
        edges={[
          { key: "e1", selected: false, pause: true },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        pauseKey="e1"
      />,
    );
    advance(LINK_MS * 2);
    // The valid input arrived: the wait ended with the same run.
    rerender(
      <Harness
        edges={[
          { key: "e1", selected: false },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        pauseKey={null}
      />,
    );
    // The held connection completes its fade the way every finished
    // link does…
    advance(16);
    expect(getOpacity(head(container, 0))).toBe("0");
    // …and the next connection is already underway, right after the
    // hold: the sweep continued instead of starting over.
    const second = head(container, 1);
    expect(getOpacity(second)).toBe("1");
    const resumed = Number(second.getAttribute("cx"));
    expect(resumed).toBeLessThan(PATH_LEN / 2);
    // It moves forward in the same rhythm, never back and never a
    // restart from the sweep's top.
    advance(16);
    const underway = Number(second.getAttribute("cx"));
    expect(underway).toBeGreaterThan(resumed);
    expect(underway).toBeLessThan(PATH_LEN / 2);
    // …keeps its own rhythm to the destination.
    advance(LINK_MS);
    expect(getOpacity(second)).toBe("0");
  });

  it("holds again at a further input of the same run (two waits)", () => {
    const { container, rerender } = render(
      <Harness
        edges={[
          { key: "e1", selected: false, pause: true },
          { key: "e2", selected: false },
          { key: "e3", selected: false },
        ]}
        paths={pathsOf(["e1", "e2", "e3"])}
        pauseKey="e1"
      />,
    );
    advance(LINK_MS * 2);
    // The user's input resumed the run and the engine immediately
    // paused again — one batched update moves the hold to e3.
    rerender(
      <Harness
        edges={[
          { key: "e1", selected: false },
          { key: "e2", selected: false },
          { key: "e3", selected: false, pause: true },
        ]}
        paths={pathsOf(["e1", "e2", "e3"])}
        pauseKey="e3"
      />,
    );
    advance(16);
    // The middle connection travels away.
    expect(getOpacity(head(container, 0))).toBe("0");
    expect(getOpacity(head(container, 1))).toBe("1");
    // …and the hold continues at the further input's end.
    advance(LINK_MS * 2);
    const third = head(container, 2);
    expect(getOpacity(third)).toBe("1");
    expect(Number(third.getAttribute("cx"))).toBe(PATH_LEN);
    expect(getOpacity(head(container, 1))).toBe("0");
  });

  it("fades the held dot once when the run fails past the input", () => {
    const { container, rerender } = render(
      <Harness
        edges={[
          { key: "e1", selected: false, pause: true },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        pauseKey="e1"
      />,
    );
    advance(LINK_MS * 2);
    // The failed submission: the wait ends and the sweep is truncated
    // to the connection that entered the input.
    rerender(
      <Harness
        edges={[{ key: "e1", selected: false }]}
        paths={pathsOf(["e1"])}
        pauseKey={null}
      />,
    );
    advance(16);
    const held = head(container, 0);
    // No hold survives the failure: the indicator fades as a finished
    // link and nothing stays lit for a run that no longer exists.
    expect(getOpacity(held)).toBe("0");
    advance(LINK_MS * 2);
    expect(getOpacity(held)).toBe("0");
  });

  it("restarts the sweep on a new run instead of realigning after a hold", () => {
    const { container, rerender } = render(
      <Harness
        edges={[
          { key: "e1", selected: false, pause: true },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        pauseKey="e1"
      />,
    );
    advance(LINK_MS * 2);
    // A new run travels its own sweep from the top.
    rerender(
      <Harness
        edges={[
          { key: "e1", selected: false },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        runId={2}
        pauseKey={null}
      />,
    );
    advance(16);
    const first = head(container, 0);
    expect(getOpacity(first)).toBe("1");
    expect(Number(first.getAttribute("cx"))).toBeLessThan(PATH_LEN / 2);
  });

  it("re-asserts the held dot when the geometry is redrawn during the wait", () => {
    const { container, rerender } = render(
      <Harness
        edges={[
          { key: "e1", selected: false, pause: true },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        pauseKey="e1"
      />,
    );
    advance(LINK_MS * 2);
    // The canvas redraws its connections (an edit elsewhere, a drag)
    // while the run keeps waiting.
    rerender(
      <Harness
        edges={[
          { key: "e1", selected: false, pause: true },
          { key: "e2", selected: false },
        ]}
        paths={pathsOf(["e1", "e2"])}
        pauseKey="e1"
      />,
    );
    advance(16);
    // The held indicator survives the redraw: still at the wait's end,
    // still opaque, on the freshly drawn geometry.
    const held = head(container, 0);
    expect(getOpacity(held)).toBe("1");
    expect(Number(held.getAttribute("cx"))).toBe(PATH_LEN);
    expect(getOpacity(head(container, 1))).toBe("0");
  });
});
