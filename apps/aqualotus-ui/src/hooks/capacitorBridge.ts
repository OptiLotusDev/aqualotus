/** Shape of the Capacitor runtime bridge injected on native shells. */
export interface CapacitorBridge {
  readonly isNativePlatform?: () => boolean;
}

/**
 * Honest predicate: true when `value` carries a callable
 * `isNativePlatform` bridge (P3/P9 `unknown` narrowing in one scope).
 */
export function hasCapacitorBridge(value: unknown): value is {
  readonly Capacitor: CapacitorBridge;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const bridge = (value as { Capacitor?: unknown }).Capacitor;
  if (typeof bridge !== "object" || bridge === null) {
    return false;
  }
  const check = (bridge as CapacitorBridge).isNativePlatform;
  return check === undefined || typeof check === "function";
}

/**
 * Honest predicate: true when running inside a Capacitor native shell.
 * Never throws; unknown shapes report false.
 */
export function isNativeMobile(value: unknown): boolean {
  try {
    if (!hasCapacitorBridge(value)) {
      return false;
    }
    return value.Capacitor.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}
