import { useCallback, useEffect, useState } from "react";

export type Theme = "night" | "light";

const STORAGE_KEY = "aqualotus-theme";

/**
 * Light Mode is temporarily unavailable.
 *
 * The theme and its tokens stay in the codebase — only the *switch* is
 * locked. While the lock is on, the app never reads or writes the Light
 * preference: a stored "light" choice cannot drag the app out of its
 * Night Mode appearance, and the toggle cannot switch to it.
 *
 * Removing this constant (and the guard below) re-enables Light Mode.
 */
export const LIGHT_MODE_ENABLED = false;

/** Why the Light Mode option cannot be picked right now. */
export const LIGHT_MODE_UNAVAILABLE_REASON =
  "Light Mode is temporarily unavailable.";

/**
 * The theme a stored preference resolves to.
 *
 * While Light Mode is locked, no stored preference can resolve to it:
 * the app starts in Night Mode whatever the user's last choice was.
 */
export function resolveTheme(
  stored: string | null,
  lightModeEnabled: boolean,
): Theme {
  if (!lightModeEnabled) return "night";
  return stored === "light" ? "light" : "night";
}

function readStored(): Theme {
  try {
    return resolveTheme(
      window.localStorage.getItem(STORAGE_KEY),
      LIGHT_MODE_ENABLED,
    );
  } catch {
    return "night";
  }
}

/**
 * Owns the UI theme (P10). Night is the product default; the choice
 * persists locally. Applies `data-theme` on the document root so the
 * centralized token layer switches wholesale.
 */
export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  /** False while Light Mode is locked off. */
  readonly lightModeAvailable: boolean;
} {
  const [theme, setTheme] = useState<Theme>(readStored);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      // Never persist a locked theme: the stored preference must not
      // survive as a way back into Light Mode.
      window.localStorage.setItem(
        STORAGE_KEY,
        LIGHT_MODE_ENABLED ? theme : "night",
      );
    } catch {
      // Private mode etc: theme still applies for the session.
    }
  }, [theme]);

  const toggle = useCallback((): void => {
    if (!LIGHT_MODE_ENABLED) return;
    setTheme((t) => (t === "night" ? "light" : "night"));
  }, []);

  return { theme, toggle, lightModeAvailable: LIGHT_MODE_ENABLED };
}
