import { useCallback, useEffect, useState } from "react";

export type Theme = "night" | "light";

const STORAGE_KEY = "aqualotus-theme";

function readStored(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light"
      ? "light"
      : "night";
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
} {
  const [theme, setTheme] = useState<Theme>(readStored);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode etc: theme still applies for the session.
    }
  }, [theme]);

  const toggle = useCallback((): void => {
    setTheme((t) => (t === "night" ? "light" : "night"));
  }, []);

  return { theme, toggle };
}
