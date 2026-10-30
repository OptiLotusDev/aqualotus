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
 *
 * The stylesheet is split into concern-based files under src/css/,
 * imported by src/index.css in one deterministic order. The contract
 * tests read every file in that same order so the cascade matches what
 * the browser (and Vite) sees.
 */

/** The stylesheet files, in the exact `@import` order of index.css. */
const CSS_FILES = [
  "css/tokens.css",
  "css/base.css",
  "css/layout-shell.css",
  "css/controls.css",
  "css/function-browser.css",
  "css/editor-canvas.css",
  "css/glass-utilities.css",
  "css/merge-join-branch.css",
  "css/block-library.css",
  "css/panels.css",
  "css/states.css",
  "css/responsive-motion.css",
  "css/hierarchy.css",
  "css/light-theme.css",
] as const;

/** The shipped stylesheet, assembled from its concern-based files. */
const rawCss = CSS_FILES.map((file) =>
  readFileSync(resolve(process.cwd(), "src", file), "utf8"),
).join("\n");
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
    // The dark theme ring is 13px, so a ±6.5px offset puts its *centre*
    // exactly on the block border — every drawn edge anchors there.
    expect(port["width"]).toBe("13px");
    const left = declarations(".vport-left");
    const right = declarations(".vport-right");
    expect(left["left"]).toBe("-6.5px");
    expect(right["right"]).toBe("-6.5px");
    expect(left["margin-top"]).toBe("-6.5px");
  });

  it("centres the vertical pair and the branch ports on the border too", () => {
    // A branch body member's top in-port and bottom out-port sit on the
    // card's horizontal centre (the body's vertical flow line).
    const top = declarations(".vport-top");
    expect(top["top"]).toBe("-6.5px");
    expect(top["margin-left"]).toBe("-6.5px");
    const outBottom = declarations(".vport-out-bottom");
    expect(outBottom["bottom"]).toBe("-6.5px");
    expect(outBottom["margin-left"]).toBe("-6.5px");
    // TRUE at 30% and FALSE at 70% of the card width: the negative
    // margin brings the ring's *centre* onto the fraction point, so the
    // fraction mirrors `BRANCH_PORT_FRACTION` in src/lib/graph.ts
    // exactly.
    const then = declarations(".vport-then.vport-bottom");
    expect(then["left"]).toBe("30%");
    expect(then["margin-left"]).toBe("-6.5px");
    const elsePort = declarations(".vport-else.vport-bottom");
    expect(elsePort["left"]).toBe("70%");
    expect(elsePort["margin-left"]).toBe("-6.5px");
  });

  it("draws the manual merge join as a draggable pill with its ports", () => {
    const join = declarations(".vjoin");
    expect(join["position"]).toBe("absolute");
    expect(join["border-radius"]).toBe("999px");
    expect(join["cursor"]).toBe("grab");
    // No fixed geometry: the pill's size is measured through the same
    // ResizeObserver pipeline as the blocks, so placing never guesses.
    expect(join["height"]).toBeUndefined();
    const dragging = declarations('.vjoin[data-dragging="true"]');
    expect(dragging["cursor"]).toBe("grabbing");
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

  it("centres the light-theme ports at their own 12px size", () => {
    // The light hollow ring is 1px smaller, so its centring offsets are
    // −6px — the same border line as the dark theme's 13px ring at −6.5.
    const port = declarations(':root[data-theme="light"] .vport');
    expect(port["width"]).toBe("12px");
    const left = declarations(':root[data-theme="light"] .vport-left');
    expect(left["left"]).toBe("-6px");
    expect(left["margin-top"]).toBe("-6px");
    const top = declarations(':root[data-theme="light"] .vport-top');
    expect(top["top"]).toBe("-6px");
    expect(top["margin-left"]).toBe("-6px");
    const outBottom = declarations(
      ':root[data-theme="light"] .vport-out-bottom',
    );
    expect(outBottom["bottom"]).toBe("-6px");
    const then = declarations(
      ':root[data-theme="light"] .vport-then.vport-bottom',
    );
    expect(then["margin-left"]).toBe("-6px");
  });

  it("keeps the connection layer transparent to the pointer", () => {
    // The arrows paint in front of the blocks, but they must never
    // swallow a click meant for a block or a port.
    const links = declarations(".links");
    expect(links["pointer-events"]).toBe("none");
  });

  it("keeps the Casting checkbox compact and inline", () => {
    const label = declarations(".field-check-label");
    expect(label["display"]).toBe("inline-flex");
    expect(label["align-items"]).toBe("center");
    const checkbox = declarations('.field-check input[type="checkbox"]');
    // The generic `.field input` 40px glass sizing must not stretch the
    // checkbox into a full-width bar.
    expect(checkbox["width"]).toBe("16px");
    expect(checkbox["height"]).toBe("16px");
    expect(checkbox["min-height"]).toBe("0");
    expect(checkbox["padding"]).toBe("0");
    expect(checkbox["flex"]).toBe("0 0 auto");
  });

  it("anchors the Casting plate above the block with an inverted-L link", () => {
    const plate = declarations(".vblock-casting");
    expect(plate["position"]).toBe("absolute");
    expect(plate["left"]).toBe("6px");
    expect(plate["bottom"]).toBe("calc(100% + 12px)");
    expect(plate["pointer-events"]).toBe("none");

    const link = declarations(".vblock-casting-link");
    expect(link["position"]).toBe("absolute");
    expect(link["top"]).toBe("100%");
    expect(link["width"]).toBe("15px");
    expect(link["height"]).toBe("12px");
    expect(link["border-left"]).toContain("1.5px solid");
    expect(link["border-bottom"]).toContain("1.5px solid");
  });
});
