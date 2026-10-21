import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The canvas style contract.
 *
 * Some of the canvas requirements are about how a shape is *painted*
 * (a full port circle, a perimeter colour, a chip that hides the rim,
 * a status light without a bloom). jsdom neither lays out nor paints,
 * and it cannot even parse the modern stylesheet, so these tests read
 * the shipped stylesheet and assert the declarations that produce those
 * results. They fail the moment a rule is changed back.
 */

/** The shipped stylesheet, read from disk (the vitest root is the app). */
const rawCss = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
/** The same stylesheet without comments, so declarations parse cleanly. */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of one rule of the stylesheet. */
function declarations(selector: string): Record<string, string> {
  const pattern = new RegExp(
    `(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const match = pattern.exec(css);
  if (match === null) throw new Error(`no rule for ${selector}`);
  const out: Record<string, string> = {};
  for (const line of match[2].split(";")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

/** Every declaration of every rule that matches a selector. */
function allDeclarations(selector: string): string[] {
  const pattern = new RegExp(
    `(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "gm",
  );
  const out: string[] = [];
  let match = pattern.exec(css);
  while (match !== null) {
    out.push(match[2]);
    match = pattern.exec(css);
  }
  return out;
}

describe("canvas style contract", () => {
  it("never clips a block, so its ports stay whole circles", () => {
    const block = declarations(".vblock");
    // The ports sit half outside the block; clipping the block would
    // cut them in half.
    expect(block["overflow"] ?? "visible").toBe("visible");
    // Every block rule keeps the content visible.
    for (const body of allDeclarations(".vblock")) {
      expect(body).not.toMatch(/overflow:\s*hidden/);
    }
  });

  it("draws the ports as circles centred on the block edge", () => {
    const port = declarations(".vport");
    expect(port["border-radius"]).toBe("50%");
    expect(port["width"]).toBe(port["height"]);
    // The circle straddles the edge: half in, half out.
    const left = declarations(".vport-left");
    const right = declarations(".vport-right");
    expect(left["left"]).toBe("-8px");
    expect(right["right"]).toBe("-8px");
  });

  it("keeps the status light a clean solid dot", () => {
    const light = declarations(".status-dot i");
    // No bloom, no halo, no coloured glow around the indicator.
    expect(light["box-shadow"] ?? "none").toBe("none");
    expect(light["box-shadow"] ?? "").not.toMatch(/drop-shadow|currentColor/);
    // The dot itself keeps its size, shape and colour.
    expect(light["border-radius"]).toBe("50%");
    expect(light["width"]).toBe(light["height"]);
    const ready = declarations('.status-dot[data-state="ready"] i');
    expect(ready["background"]).toBe("var(--success)");
  });

  it("colours the whole block perimeter with the block's own hue", () => {
    const block = declarations(".vblock");
    const shadow = block["box-shadow"] ?? "";
    // A rim on every side (an inset ring plus the outer ring), both in
    // the block's hierarchy colour.
    expect(shadow).toMatch(/inset 0 0 0 1px color-mix\(in srgb, var\(--neon\)/);
    expect(shadow).toMatch(/0 0 0 1px color-mix\(in srgb, var\(--neon\)/);
    // The rim is not a neon bloom.
    expect(shadow).not.toMatch(/0 0 (2[0-9]|[3-9][0-9])px/);
  });

  it("hides the hierarchy rim under every title chip", () => {
    for (const selector of [".pkg-head", ".structc-head", ".funcc-head"]) {
      const chip = declarations(selector);
      // An opaque plate: the rim is interrupted under the chip instead
      // of running across the label.
      expect(chip["background"]).toBe("var(--chip-plate)");
    }
    // The plate itself is opaque, so the rim cannot bleed through.
    const plate = declarations(":root");
    expect(plate["--chip-plate"]).toMatch(
      /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/,
    );
  });

  it("keeps the light theme implementation in place", () => {
    // The lock is a switch, not a removal: the theme and its tokens
    // stay in the stylesheet.
    expect(rawCss).toContain(':root[data-theme="light"]');
    expect(rawCss).toContain("--chip-plate");
  });

  it("keeps the connection layer transparent to the pointer", () => {
    // The arrows paint in front of the blocks, but they must never
    // swallow a click meant for a block or a port.
    const links = declarations(".links");
    expect(links["pointer-events"]).toBe("none");
  });
});
