import { describe, expect, it } from "vitest";
import {
  breadcrumbPath,
  layoutFunctionContainers,
  PACKAGE_NAME,
  PRESENTATION_STRUCT_NAME,
} from "./workspace";

describe("breadcrumbPath", () => {
  it("reads package / struct / function", () => {
    expect(breadcrumbPath("main")).toBe(
      `${PACKAGE_NAME} / ${PRESENTATION_STRUCT_NAME} / main`,
    );
    expect(breadcrumbPath(null)).toBe(
      `${PACKAGE_NAME} / ${PRESENTATION_STRUCT_NAME}`,
    );
  });
});

describe("layoutFunctionContainers", () => {
  it("stacks containers vertically without overlap", () => {
    const layout = layoutFunctionContainers([0, 1], 64, 28, { 0: 200, 1: 220 });
    expect(layout[0]).toEqual({ x: 28, y: 64 });
    expect(layout[1]).toEqual({ x: 28, y: 292 });
  });
});
