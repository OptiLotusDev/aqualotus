import { describe, expect, it } from "vitest";
import { hasCapacitorBridge, isNativeMobile } from "./capacitorBridge";

describe("hasCapacitorBridge", () => {
  it("accepts objects carrying a callable bridge", () => {
    expect(
      hasCapacitorBridge({ Capacitor: { isNativePlatform: () => true } }),
    ).toBe(true);
  });

  it("accepts a bridge without the optional check", () => {
    expect(hasCapacitorBridge({ Capacitor: {} })).toBe(true);
  });

  it("rejects null, primitives, and malformed bridges", () => {
    expect(hasCapacitorBridge(null)).toBe(false);
    expect(hasCapacitorBridge("Capacitor")).toBe(false);
    expect(hasCapacitorBridge({})).toBe(false);
    expect(hasCapacitorBridge({ Capacitor: 42 })).toBe(false);
    expect(
      hasCapacitorBridge({ Capacitor: { isNativePlatform: "yes" } }),
    ).toBe(false);
  });
});

describe("isNativeMobile", () => {
  it("mirrors the bridge answer and never throws", () => {
    expect(
      isNativeMobile({ Capacitor: { isNativePlatform: () => true } }),
    ).toBe(true);
    expect(
      isNativeMobile({ Capacitor: { isNativePlatform: () => false } }),
    ).toBe(false);
    expect(isNativeMobile(null)).toBe(false);
    expect(isNativeMobile({})).toBe(false);
  });
});
