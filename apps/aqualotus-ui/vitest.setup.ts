import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// The engine integration tests render the real app against the real
// WASM artifact. While every test file runs in its own worker, the
// machine can be busy enough that the first projection needs more than
// the 1 s default for `waitFor`/`findBy`.
configure({ asyncUtilTimeout: 5_000 });

/**
 * jsdom implements no SVG geometry, but the travelling indicator reads
 * the connection path the way the design guide does: the total length of
 * the path and the point at a given length. The stub models a straight
 * 100 unit path, so a test can assert exactly where the indicator is.
 *
 * jsdom has no `SVGPathElement`; every SVG shape is an `SVGElement`
 * (or an `SVGGraphicsElement`), so the geometry lives on those.
 */
function stubGeometry(proto: object | undefined): void {
  if (proto === undefined) return;
  const target = proto as Record<string, unknown>;
  if (typeof target["getTotalLength"] === "function") return;
  target["getTotalLength"] = function getTotalLength(): number {
    return 100;
  };
  target["getPointAtLength"] = function getPointAtLength(
    length: number,
  ): DOMPoint {
    return { x: length, y: 0 } as DOMPoint;
  };
}

const svgGlobals = globalThis as unknown as {
  SVGElement?: { prototype: object };
  SVGGraphicsElement?: { prototype: object };
};
stubGeometry(svgGlobals.SVGElement?.prototype);
stubGeometry(svgGlobals.SVGGraphicsElement?.prototype);
