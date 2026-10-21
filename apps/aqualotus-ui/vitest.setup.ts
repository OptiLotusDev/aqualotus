import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

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
