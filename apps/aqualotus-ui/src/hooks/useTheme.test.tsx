import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  LIGHT_MODE_ENABLED,
  LIGHT_MODE_UNAVAILABLE_REASON,
  resolveTheme,
  useTheme,
  type Theme,
} from "./useTheme";

const seen: Theme[] = [];

function Probe(): React.JSX.Element {
  const { theme, toggle, lightModeAvailable } = useTheme();
  seen.push(theme);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-disabled={lightModeAvailable ? undefined : true}
      title={lightModeAvailable ? undefined : LIGHT_MODE_UNAVAILABLE_REASON}
    >
      {theme}
    </button>
  );
}

describe("useTheme", () => {
  it("keeps the app in night mode while light mode is locked off", () => {
    window.localStorage.clear();
    seen.length = 0;
    const { unmount } = render(<Probe />);
    expect(screen.getByRole("button").textContent).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
    act(() => {
      screen.getByRole("button").click();
    });
    // The toggle cannot reach Light Mode.
    expect(screen.getByRole("button").textContent).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
    unmount();
    window.localStorage.clear();
    document.documentElement.dataset.theme = "night";
  });

  it("does not let a stored light preference activate light mode", () => {
    window.localStorage.setItem("aqualotus-theme", "light");
    const { unmount } = render(<Probe />);
    expect(screen.getByRole("button").textContent).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
    // The locked preference is not even kept around.
    expect(window.localStorage.getItem("aqualotus-theme")).toBe("night");
    unmount();
    window.localStorage.clear();
    document.documentElement.dataset.theme = "night";
  });

  it("reports the light mode option as unavailable", () => {
    window.localStorage.clear();
    const { unmount } = render(<Probe />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("title")).toBe(LIGHT_MODE_UNAVAILABLE_REASON);
    unmount();
  });

  it("keeps the light mode implementation available behind the lock", () => {
    // The theme itself is untouched: only the switch is locked.
    expect(LIGHT_MODE_ENABLED).toBe(false);
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("night", true)).toBe("night");
    expect(resolveTheme(null, true)).toBe("night");
    // While locked, no stored value resolves to light.
    expect(resolveTheme("light", LIGHT_MODE_ENABLED)).toBe("night");
  });
});
