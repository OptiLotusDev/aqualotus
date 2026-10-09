/**
 * Shell detection (presentation-layer only — never runtime semantics).
 *
 * Tauri 2 exposes `window.__TAURI_INTERNALS__` (v2) / `window.__TAURI__`
 * (v1 compat) inside its WebViews. Plain web builds have neither, so
 * canvas startup behavior can differ per shell: Tauri cold-starts with
 * an unmeasured window and needs startup fit, while web keeps the
 * classic 100% park.
 */
export function isTauriShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return (
    ("__TAURI_INTERNALS__" in w && w["__TAURI_INTERNALS__"] !== undefined) ||
    ("__TAURI__" in w && w["__TAURI__"] !== undefined)
  );
}
