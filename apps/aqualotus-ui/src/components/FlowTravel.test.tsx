import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import FlowTravel from "./FlowTravel";

/**
 * The travelling indicator (OptiLotus design guide: "a dot travels each
 * link in order"). The tests drive the animation frames by hand, so
 * every assertion is deterministic — no real-time waits.
 */

const LINK_MS = 300;
/** The stubbed path model: a straight path of 100 units. */
const PATH_LEN = 100;

interface HarnessProps {
  readonly edges: { key: string; selected: boolean }[];
  readonly paths: ReadonlyMap<string, SVGPathElement>;
  readonly linkMs?: number;
  readonly runId?: number;
  readonly reduced?: boolean;
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
  const { edges, paths, linkMs = LINK_MS, runId = 1, reduced = false } = props;
  return (
    <svg>
      <FlowTravel
        edges={edges}
        paths={paths}
        linkMs={linkMs}
        runId={runId}
        reduced={reduced}
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
    expect(dot.getAttribute("opacity")).toBe("1");
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
    expect(dot.getAttribute("opacity")).toBe("0");
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
    expect(first.getAttribute("opacity")).toBe("1");
    expect(second.getAttribute("opacity")).toBe("0");

    // Now the second link travels.
    advance(LINK_MS / 2 + 32);
    expect(first.getAttribute("opacity")).toBe("0");
    expect(second.getAttribute("opacity")).toBe("1");
    expect(Number(second.getAttribute("cx"))).toBeGreaterThan(0);
  });

  it("wears the colour of the connection it rides", () => {
    const { container } = render(
      <Harness
        edges={[
          { key: "e1", selected: false },
          { key: "e2", selected: true },
        ]}
        paths={pathsOf(["e1", "e2"])}
      />,
    );
    // The selected connection keeps its own (selected) colour token.
    expect(head(container, 0).getAttribute("class")).toBe("flow-dot");
    expect(head(container, 1).getAttribute("class")).toBe(
      "flow-dot edge-selected",
    );
    const trail = container.querySelectorAll("circle.flow-trail")[1];
    expect(trail?.getAttribute("class")).toBe("flow-trail edge-selected");
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
    expect(dot.getAttribute("opacity")).toBe("0");
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
    expect(dot.getAttribute("opacity")).toBe("1");

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
    expect(dot.getAttribute("opacity")).toBe("1");
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
});
