import { afterEach, describe, expect, it } from "vitest";
import { isTauriShell } from "./env";

describe("isTauriShell", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[
      "__TAURI_INTERNALS__"
    ];
    delete (window as unknown as Record<string, unknown>)["__TAURI__"];
  });

  it("is false on plain web", () => {
    expect(isTauriShell()).toBe(false);
  });

  it("detects the Tauri v2 internals flag", () => {
    (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] = {};
    expect(isTauriShell()).toBe(true);
  });

  it("detects the Tauri v1 compat flag", () => {
    (window as unknown as Record<string, unknown>)["__TAURI__"] = {};
    expect(isTauriShell()).toBe(true);
  });
});
