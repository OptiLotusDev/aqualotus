import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AppShell from "../../components/AppShell";

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

vi.mock("../../lib/optilotus", () => ({
  optilotus_type: {
    int8: "int8",
    int16: "int16",
    int32: "int32",
    int64: "int64",
    uint8: "uint8",
    uint16: "uint16",
    uint32: "uint32",
    uint64: "uint64",
    float32: "float32",
    float64: "float64",
    bool: "bool",
    char: "char",
    string: "string",
    void: "void",
  },
  optilotus_getFunction: vi.fn(() => ({
    status: "ok",
    id: 0,
    name: "main",
    isMain: true,
    entry: 1,
    commandCount: 2,
  })),
}));

import { canvasState, shellProps } from "./appShell.test-helpers";

describe("AppShell panels", () => {
  it("opens and closes the blocks panel", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const toggle = container.querySelector(
      'button[aria-label="Toggle blocks panel"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      container.querySelector('aside[aria-label="Library and functions"]'),
    ).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('aside[aria-label="Library and functions"]'),
    ).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      container.querySelector('aside[aria-label="Library and functions"]'),
    ).toBeNull();
  });

  it("opens and closes the inspector", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const toggle = container.querySelector(
      'button[aria-label="Toggle inspector"]',
    ) as HTMLButtonElement;
    expect(container.querySelector('aside[aria-label="Inspector"]')).toBeNull();

    fireEvent.click(toggle);
    const panel = container.querySelector('aside[aria-label="Inspector"]');
    expect(panel).not.toBeNull();
    // The panel can be closed again from inside it.
    fireEvent.click(
      panel?.querySelector('button[aria-label="Hide inspector"]') as Element,
    );
    expect(container.querySelector('aside[aria-label="Inspector"]')).toBeNull();
  });

  it("expands and collapses the runner", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const expand = container.querySelector(
      'button[aria-label="Expand runner"]',
    ) as HTMLButtonElement;
    expect(expand).not.toBeNull();
    fireEvent.click(expand);
    expect(
      container.querySelector('section[aria-label="Runner"]'),
    ).not.toBeNull();

    const collapse = container.querySelector(
      'button[aria-label="Collapse runner"]',
    ) as HTMLButtonElement;
    fireEvent.click(collapse);
    expect(container.querySelector('section[aria-label="Runner"]')).toBeNull();
    // The collapsed runner stays reachable as a pill.
    expect(
      container.querySelector('button[aria-label="Expand runner"]'),
    ).not.toBeNull();
  });

  it("survives rapid open and close cycles without stale panels", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const left = container.querySelector(
      'button[aria-label="Toggle blocks panel"]',
    ) as HTMLButtonElement;
    const inspector = container.querySelector(
      'button[aria-label="Toggle inspector"]',
    ) as HTMLButtonElement;
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(left);
      fireEvent.click(inspector);
      fireEvent.click(left);
      fireEvent.click(inspector);
    }
    // The last click closed them: no stale panel is left behind, and the
    // toggles agree with what is on screen.
    expect(
      container.querySelectorAll('aside[aria-label="Library and functions"]')
        .length,
    ).toBe(0);
    expect(
      container.querySelectorAll('aside[aria-label="Inspector"]').length,
    ).toBe(0);
    expect(left.getAttribute("aria-pressed")).toBe("false");
    expect(inspector.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the canvas usable while a panel is open", async () => {
    const props = shellProps();
    const { container } = render(<AppShell {...props} />);
    fireEvent.click(
      container.querySelector(
        'button[aria-label="Toggle blocks panel"]',
      ) as Element,
    );
    // The open panel does not swallow the canvas: a block is still
    // selectable behind it.
    const block = container.querySelector('[data-block-id="1"]') as Element;
    fireEvent.pointerDown(block, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      button: 0,
    });
    fireEvent.pointerUp(container.querySelector("#board") as Element, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    expect(props.onSelectCommand).toHaveBeenCalledWith(1);
  });

  it("does not move the canvas when the functions panel opens or closes", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const before = canvasState(container);

    const toggle = container.querySelector(
      'button[aria-label="Toggle blocks panel"]',
    ) as HTMLButtonElement;
    // Opening the panel overlays the canvas; it never reflows it.
    fireEvent.click(toggle);
    expect(canvasState(container)).toEqual(before);
    fireEvent.click(toggle);
    expect(canvasState(container)).toEqual(before);
    // Repeated toggles keep it stable too.
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(toggle);
    }
    expect(canvasState(container)).toEqual(before);
  });

  it("cannot switch to light mode while it is unavailable", () => {
    const { container } = render(<AppShell {...shellProps()} />);
    const toggle = container.querySelector(
      'button[aria-label="Light Mode is temporarily unavailable."]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    // Pressing it changes nothing.
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("night");
  });
});
