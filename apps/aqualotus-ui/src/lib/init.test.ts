import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the generated WASM glue: `init` is the only import with behavior
// under test. Every other export is a stub the bridge never calls here.
const wasmMocks = vi.hoisted(() => ({
  init: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("../wasm/optilotus/optilotus.js", () => ({
  default: wasmMocks.init,
  optilotus_assign: vi.fn(),
  optilotus_clearPackage: vi.fn(),
  optilotus_createFunction: vi.fn(),
  optilotus_declare: vi.fn(),
  optilotus_deleteCommand: vi.fn(),
  optilotus_deleteFunction: vi.fn(),
  optilotus_getFunction: vi.fn(),
  optilotus_health: vi.fn(() => "ok"),
  optilotus_listCommands: vi.fn(),
  optilotus_listFunctions: vi.fn(),
  optilotus_print: vi.fn(),
  optilotus_return: vi.fn(),
  optilotus_runProgram: vi.fn(),
  optilotus_setEntry: vi.fn(),
  optilotus_setNext: vi.fn(),
  optilotus_version: vi.fn(() => "0.0.0-test"),
}));

import {
  optilotus_health,
  optilotus_resetInitForTesting,
  optilotus_tryEnsure,
  optilotus_version,
} from "./optilotus";

beforeEach(() => {
  optilotus_resetInitForTesting();
  wasmMocks.init.mockReset();
});

describe("optilotus_tryEnsure", () => {
  it("initializes once and caches success", async () => {
    wasmMocks.init.mockResolvedValue(undefined);
    await optilotus_tryEnsure();
    await optilotus_tryEnsure();
    expect(wasmMocks.init).toHaveBeenCalledOnce();
    expect(optilotus_version()).toBe("0.0.0-test");
    expect(optilotus_health()).toBe("ok");
  });

  it("shares one in-flight promise across concurrent callers", async () => {
    let release!: () => void;
    const gate = new Promise<unknown>((resolve) => {
      release = () => resolve(undefined);
    });
    wasmMocks.init.mockReturnValue(gate);
    const first = optilotus_tryEnsure();
    const second = optilotus_tryEnsure();
    expect(wasmMocks.init).toHaveBeenCalledOnce();
    release();
    await first;
    await second;
    // Still cached after completion: no second init.
    await optilotus_tryEnsure();
    expect(wasmMocks.init).toHaveBeenCalledOnce();
  });

  it("a failed attempt does not poison later retries", async () => {
    wasmMocks.init.mockRejectedValueOnce(new Error("bad MIME type"));
    await expect(optilotus_tryEnsure()).rejects.toThrow("bad MIME type");
    wasmMocks.init.mockResolvedValueOnce(undefined);
    await optilotus_tryEnsure();
    expect(wasmMocks.init).toHaveBeenCalledTimes(2);
    expect(optilotus_version()).toBe("0.0.0-test");
  });

  it("repeated failures keep retrying instead of replaying one rejection", async () => {
    wasmMocks.init.mockRejectedValue(new Error("offline"));
    await expect(optilotus_tryEnsure()).rejects.toThrow("offline");
    await expect(optilotus_tryEnsure()).rejects.toThrow("offline");
    expect(wasmMocks.init).toHaveBeenCalledTimes(2);
    wasmMocks.init.mockResolvedValue(undefined);
    await optilotus_tryEnsure();
    expect(wasmMocks.init).toHaveBeenCalledTimes(3);
  });

  it("a stale failure cannot invalidate a newer attempt", async () => {
    // Slow first attempt fails after the cache was reset and a second
    // attempt already succeeded: the guarded handler must not clear the
    // newer (successful) state.
    let failFirst!: (e: unknown) => void;
    const slow = new Promise<unknown>((_, reject) => {
      failFirst = reject;
    });
    wasmMocks.init.mockReturnValueOnce(slow);
    const stale = optilotus_tryEnsure();
    const staleGuard = stale.catch(() => "stale-failed");
    // Simulate a fresh owner retrying (e.g. after a test reset).
    optilotus_resetInitForTesting();
    wasmMocks.init.mockResolvedValueOnce(undefined);
    await optilotus_tryEnsure();
    failFirst(new Error("late failure"));
    await expect(staleGuard).resolves.toBe("stale-failed");
    // Success is still cached: no further init call.
    await optilotus_tryEnsure();
    expect(wasmMocks.init).toHaveBeenCalledTimes(2);
  });
});
